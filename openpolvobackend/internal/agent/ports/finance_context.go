package ports

// FinanceContext snapshot para o Intelligence (gastos, assinaturas).
type FinanceContext struct {
	Categories       []FinanceCategoryBrief    `json:"categories,omitempty"`
	RecentTransactions []FinanceTransactionBrief `json:"recent_transactions,omitempty"`
	CategoryTotals   []FinanceCategoryTotal  `json:"category_totals_month,omitempty"`
	Subscriptions    []FinanceSubscriptionBrief `json:"subscriptions,omitempty"`
}

type FinanceCategoryBrief struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id,omitempty"`
	Name     string  `json:"name"`
}

type FinanceTransactionBrief struct {
	ID          string `json:"id"`
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	Direction   string `json:"direction"`
	Description string `json:"description"`
	OccurredAt  string `json:"occurred_at"`
	Category    string `json:"category,omitempty"`
	Subcategory string `json:"subcategory,omitempty"`
}

type FinanceCategoryTotal struct {
	Category string `json:"category"`
	Direction  string `json:"direction"`
	SumMinor   int64  `json:"sum_minor"`
}

type FinanceSubscriptionBrief struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	AmountMinor int64   `json:"amount_minor"`
	Currency    string  `json:"currency"`
	Cadence     string  `json:"cadence"`
	NextDueAt   string  `json:"next_due_at"`
	Status      string  `json:"status"`
	LastPaidAt  *string `json:"last_paid_at,omitempty"`
}
