export async function bulkDeleteTransactions(transactionIds) {
    try {
        const { userId } = await auth();
        if (!userId) throw new Error("Unauthorized");

        const user = await db.user.findUnique({
            where: { clerkUserId: userId },
        });

        if (!user) throw new Error("User not found");

        // Fetch transactions to calculate balance changes
        const transactions = await db.transaction.findMany({
            where: {
                id: { in: transactionIds },
                userId: user.id,
            },
        });

        // if (transactions.length === 0) {
        //     throw new Error("No transactions found for deletion.");
        // }

        // Group transactions by account to update balances
        const accountBalanceChanges = transactions.reduce((acc, transaction) => {
            const change =
                transaction.type === "EXPENSE"
                    ? transaction.amount
                    : -transaction.amount;

            if (!acc[transaction.accountId]) {
                acc[transaction.accountId] = 0;
            }

            acc[transaction.accountId] += change;
            return acc;
        }, {});

        // Delete transactions and update account balances in a transaction
        await db.$transaction(async (tx) => {
            // Delete transactions
            await tx.transaction.deleteMany({
                where: {
                    id: { in: transactionIds },
                    userId: user.id,
                },
            });

            // Update account balances
            for (const [accountId, balanceChange] of Object.entries(accountBalanceChanges)) {
                const numericBalanceChange = Number(balanceChange);

                // Validate balanceChange is a valid number
                if (isNaN(numericBalanceChange)) {
                    console.error(`Skipping invalid balance change for account ${accountId}:`, balanceChange);
                    continue; // Skip invalid entries
                }

                await tx.account.update({
                    where: { id: accountId },
                    data: {
                        balance: {
                            increment: numericBalanceChange,
                        },
                    },
                });
            }
        });

        // Revalidate paths to reflect the changes
        revalidatePath("/dashboard");
        revalidatePath("/account/[id]");

        return { success: true };
    } catch (error) {
        console.error("Error in bulkDeleteTransactions:", error);
        return { success: false, error: error.message };
    }
}