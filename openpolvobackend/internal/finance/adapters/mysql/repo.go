package mysql

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/finance/domain"
	"github.com/open-polvo/open-polvo/internal/finance/ports"
)

// Store implementa repositórios de finanças em SQLite.
type Store struct {
	DB *sql.DB
}

var (
	_ ports.CategoryRepository     = (*Store)(nil)
	_ ports.TransactionRepository = (*Store)(nil)
	_ ports.SubscriptionRepository = (*Store)(nil)
	_ ports.DigestRepository       = (*Store)(nil)
)

func NewStore(db *sql.DB) *Store { return &Store{DB: db} }

// ─── Categories ──────────────────────────────────────────────────────────────

func (s *Store) CreateCategory(ctx context.Context, c *domain.Category) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO laele_finance_categories (id, user_id, parent_id, name, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		c.ID.String(), c.UserID.String(), nullableUUID(c.ParentID), c.Name, c.SortOrder, c.CreatedAt, c.UpdatedAt,
	)
	return err
}

func (s *Store) UpdateCategory(ctx context.Context, c *domain.Category) error {
	res, err := s.DB.ExecContext(ctx,
		`UPDATE laele_finance_categories SET parent_id = ?, name = ?, sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		nullableUUID(c.ParentID), c.Name, c.SortOrder, c.UpdatedAt, c.ID.String(), c.UserID.String(),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteCategory(ctx context.Context, id, userID uuid.UUID) error {
	res, err := s.DB.ExecContext(ctx,
		`DELETE FROM laele_finance_categories WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) ListCategoriesByUser(ctx context.Context, userID uuid.UUID) ([]domain.Category, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, user_id, parent_id, name, sort_order, created_at, updated_at
		 FROM laele_finance_categories WHERE user_id = ? ORDER BY parent_id IS NULL DESC, sort_order, name`,
		userID.String(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCategories(rows)
}

func (s *Store) GetCategory(ctx context.Context, id, userID uuid.UUID) (*domain.Category, error) {
	row := s.DB.QueryRowContext(ctx,
		`SELECT id, user_id, parent_id, name, sort_order, created_at, updated_at
		 FROM laele_finance_categories WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	return scanCategoryRow(row)
}

// ─── Transactions ────────────────────────────────────────────────────────────

func (s *Store) CreateTransaction(ctx context.Context, t *domain.Transaction) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO laele_finance_transactions
		 (id, user_id, amount_minor, currency, direction, category_id, subcategory_id, occurred_at, description, source, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID.String(), t.UserID.String(), t.AmountMinor, t.Currency, string(t.Direction),
		nullableUUID(t.CategoryID), nullableUUID(t.SubcategoryID), t.OccurredAt, t.Description, string(t.Source), t.CreatedAt,
	)
	return err
}

func (s *Store) DeleteTransaction(ctx context.Context, id, userID uuid.UUID) error {
	res, err := s.DB.ExecContext(ctx,
		`DELETE FROM laele_finance_transactions WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) GetTransaction(ctx context.Context, id, userID uuid.UUID) (*domain.Transaction, error) {
	row := s.DB.QueryRowContext(ctx,
		`SELECT id, user_id, amount_minor, currency, direction, category_id, subcategory_id, occurred_at, description, source, created_at
		 FROM laele_finance_transactions WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	t, err := scanTx(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return t, nil
}

func (s *Store) UpdateTransaction(ctx context.Context, t *domain.Transaction) error {
	res, err := s.DB.ExecContext(ctx,
		`UPDATE laele_finance_transactions SET category_id = ?, subcategory_id = ?, description = ?
		 WHERE id = ? AND user_id = ?`,
		nullableUUID(t.CategoryID), nullableUUID(t.SubcategoryID), t.Description, t.ID.String(), t.UserID.String(),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) ListTransactionsByRange(ctx context.Context, userID uuid.UUID, from, to time.Time, direction *domain.Direction) ([]domain.Transaction, error) {
	q := `SELECT id, user_id, amount_minor, currency, direction, category_id, subcategory_id, occurred_at, description, source, created_at
		FROM laele_finance_transactions WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?`
	args := []any{userID.String(), from, to}
	if direction != nil {
		q += ` AND direction = ?`
		args = append(args, string(*direction))
	}
	q += ` ORDER BY occurred_at DESC, created_at DESC`
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTransactions(rows)
}

func (s *Store) SumByCategoryMonth(ctx context.Context, userID uuid.UUID, monthStart, monthEnd time.Time) ([]ports.CategorySumRow, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT t.direction, COALESCE(c.name, ''), COALESCE(SUM(t.amount_minor), 0)
		 FROM laele_finance_transactions t
		 LEFT JOIN laele_finance_categories c ON c.id = t.category_id
		 WHERE t.user_id = ? AND t.occurred_at >= ? AND t.occurred_at < ?
		 GROUP BY t.direction, c.id, c.name`,
		userID.String(), monthStart, monthEnd,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ports.CategorySumRow
	for rows.Next() {
		var dir, name string
		var sum int64
		if err := rows.Scan(&dir, &name, &sum); err != nil {
			return nil, err
		}
		d := domain.Direction(dir)
		out = append(out, ports.CategorySumRow{CategoryID: nil, CategoryName: name, Direction: d, SumMinor: sum})
	}
	return out, rows.Err()
}

func (s *Store) ListRecentTransactions(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Transaction, error) {
	if limit <= 0 {
		limit = 30
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, user_id, amount_minor, currency, direction, category_id, subcategory_id, occurred_at, description, source, created_at
		 FROM laele_finance_transactions WHERE user_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT ?`,
		userID.String(), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTransactions(rows)
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

func (s *Store) CreateSubscription(ctx context.Context, sub *domain.Subscription) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO laele_finance_subscriptions
		 (id, user_id, name, amount_minor, currency, cadence, anchor_day, next_due_at, status, last_paid_at, reminder_active, last_reminder_sent_on, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sub.ID.String(), sub.UserID.String(), sub.Name, sub.AmountMinor, sub.Currency, string(sub.Cadence),
		nullableInt8(sub.AnchorDay), sub.NextDueAt, string(sub.Status),
		sub.LastPaidAt, boolTiny(sub.ReminderActive), nullableDate(sub.LastReminderSentAt), sub.CreatedAt, sub.UpdatedAt,
	)
	return err
}

func (s *Store) UpdateSubscription(ctx context.Context, sub *domain.Subscription) error {
	res, err := s.DB.ExecContext(ctx,
		`UPDATE laele_finance_subscriptions SET name = ?, amount_minor = ?, currency = ?, cadence = ?, anchor_day = ?,
		 next_due_at = ?, status = ?, last_paid_at = ?, reminder_active = ?, last_reminder_sent_on = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`,
		sub.Name, sub.AmountMinor, sub.Currency, string(sub.Cadence), nullableInt8(sub.AnchorDay),
		sub.NextDueAt, string(sub.Status), sub.LastPaidAt, boolTiny(sub.ReminderActive), nullableDate(sub.LastReminderSentAt),
		sub.UpdatedAt, sub.ID.String(), sub.UserID.String(),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteSubscription(ctx context.Context, id, userID uuid.UUID) error {
	res, err := s.DB.ExecContext(ctx,
		`DELETE FROM laele_finance_subscriptions WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) ListSubscriptionsByUser(ctx context.Context, userID uuid.UUID) ([]domain.Subscription, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, user_id, name, amount_minor, currency, cadence, anchor_day, next_due_at, status, last_paid_at, reminder_active, last_reminder_sent_on, created_at, updated_at
		 FROM laele_finance_subscriptions WHERE user_id = ? ORDER BY next_due_at ASC`,
		userID.String(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSubscriptions(rows)
}

func (s *Store) GetSubscription(ctx context.Context, id, userID uuid.UUID) (*domain.Subscription, error) {
	row := s.DB.QueryRowContext(ctx,
		`SELECT id, user_id, name, amount_minor, currency, cadence, anchor_day, next_due_at, status, last_paid_at, reminder_active, last_reminder_sent_on, created_at, updated_at
		 FROM laele_finance_subscriptions WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	return scanSubscriptionRow(row)
}

func (s *Store) ListActiveDueOnOrBefore(ctx context.Context, userID uuid.UUID, t time.Time) ([]domain.Subscription, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, user_id, name, amount_minor, currency, cadence, anchor_day, next_due_at, status, last_paid_at, reminder_active, last_reminder_sent_on, created_at, updated_at
		 FROM laele_finance_subscriptions WHERE user_id = ? AND status = 'active' AND next_due_at <= ?`,
		userID.String(), t,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSubscriptions(rows)
}

// ─── Digest ──────────────────────────────────────────────────────────────────

func (s *Store) GetDigestSettings(ctx context.Context, userID uuid.UUID) (*domain.DigestSettings, error) {
	row := s.DB.QueryRowContext(ctx,
		`SELECT user_id, timezone, digest_hour, digest_enabled, include_finance_summary, include_tasks, last_digest_sent_on, updated_at
		 FROM laele_user_digest_settings WHERE user_id = ?`,
		userID.String(),
	)
	var (
		uid, tz              string
		hour                 int
		en, incFin, incTasks int8
		lastDigest           sql.NullTime
		updated              time.Time
	)
	err := row.Scan(&uid, &tz, &hour, &en, &incFin, &incTasks, &lastDigest, &updated)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &domain.DigestSettings{
				UserID: userID, Timezone: "Europe/Lisbon", DigestHour: 8, DigestEnabled: false,
				IncludeFinanceSummary: true, IncludeTasks: true, UpdatedAt: time.Now().UTC(),
			}, nil
		}
		return nil, err
	}
	uidParsed, _ := uuid.Parse(uid)
	d := &domain.DigestSettings{
		UserID: uidParsed, Timezone: tz, DigestHour: hour, DigestEnabled: en != 0,
		IncludeFinanceSummary: incFin != 0, IncludeTasks: incTasks != 0, UpdatedAt: updated,
	}
	if lastDigest.Valid {
		t := lastDigest.Time.UTC()
		d.LastDigestSentOn = &t
	}
	return d, nil
}

func (s *Store) UpsertDigestSettings(ctx context.Context, d *domain.DigestSettings) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO laele_user_digest_settings (user_id, timezone, digest_hour, digest_enabled, include_finance_summary, include_tasks, last_digest_sent_on, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
		 ON DUPLICATE KEY UPDATE
		   timezone = new.timezone,
		   digest_hour = new.digest_hour,
		   digest_enabled = new.digest_enabled,
		   include_finance_summary = new.include_finance_summary,
		   include_tasks = new.include_tasks,
		   last_digest_sent_on = new.last_digest_sent_on,
		   updated_at = new.updated_at`,
		d.UserID.String(), d.Timezone, d.DigestHour, d.DigestEnabled, d.IncludeFinanceSummary, d.IncludeTasks,
		nullableDate(d.LastDigestSentOn), d.UpdatedAt,
	)
	return err
}

func (s *Store) ListDigestEnabled(ctx context.Context) ([]domain.DigestSettings, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT user_id, timezone, digest_hour, digest_enabled, include_finance_summary, include_tasks, last_digest_sent_on, updated_at
		 FROM laele_user_digest_settings WHERE digest_enabled = 1`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.DigestSettings
	for rows.Next() {
		var uid, tz string
		var hour int
		var en, incFin, incTasks int8
		var lastDigest sql.NullTime
		var updated time.Time
		if err := rows.Scan(&uid, &tz, &hour, &en, &incFin, &incTasks, &lastDigest, &updated); err != nil {
			return nil, err
		}
		id, _ := uuid.Parse(uid)
		d := domain.DigestSettings{
			UserID: id, Timezone: tz, DigestHour: hour, DigestEnabled: en != 0,
			IncludeFinanceSummary: incFin != 0, IncludeTasks: incTasks != 0, UpdatedAt: updated,
		}
		if lastDigest.Valid {
			t := lastDigest.Time.UTC()
			d.LastDigestSentOn = &t
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// SubReminderRow assinatura em lembrete com e-mail do utilizador.
type SubReminderRow struct {
	Sub   domain.Subscription
	Email string
}

// ListSubscriptionReminders devolve assinaturas activas com vencimento até `day` (data UTC YYYY-MM-DD)
// e ainda sem lembrete enviado nesse dia civil.
func (s *Store) ListSubscriptionReminders(ctx context.Context, dayUTC time.Time) ([]SubReminderRow, error) {
	d := dayUTC.UTC().Format("2006-01-02")
	rows, err := s.DB.QueryContext(ctx,
		`SELECT s.id, s.user_id, s.name, s.amount_minor, s.currency, s.cadence, s.anchor_day, s.next_due_at, s.status, s.last_paid_at, s.reminder_active, s.last_reminder_sent_on, s.created_at, s.updated_at, u.email
		 FROM laele_finance_subscriptions s
		 INNER JOIN laele_users u ON u.id = s.user_id
		 WHERE s.status = 'active' AND DATE(s.next_due_at) <= ?
		   AND (s.last_reminder_sent_on IS NULL OR s.last_reminder_sent_on < ?)`,
		d, d,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SubReminderRow
	for rows.Next() {
		sub, email, err := scanSubscriptionWithEmail(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, SubReminderRow{Sub: *sub, Email: email})
	}
	return out, rows.Err()
}

func scanSubscriptionWithEmail(scanner interface {
	Scan(dest ...any) error
}) (*domain.Subscription, string, error) {
	var id, uid, name, cur, cad, st, email string
	var amount int64
	var anchor sql.NullInt64
	var next, created, updated time.Time
	var lastPaid sql.NullTime
	var rem int8
	var lastRem sql.NullTime
	if err := scanner.Scan(&id, &uid, &name, &amount, &cur, &cad, &anchor, &next, &st, &lastPaid, &rem, &lastRem, &created, &updated, &email); err != nil {
		return nil, "", err
	}
	return subscriptionFromScanned(id, uid, name, amount, cur, cad, anchor, next, st, lastPaid, rem, lastRem, created, updated), email, nil
}

func subscriptionFromScanned(
	id, uid, name string, amount int64, cur, cad string, anchor sql.NullInt64, next time.Time, st string,
	lastPaid sql.NullTime, rem int8, lastRem sql.NullTime, created, updated time.Time,
) *domain.Subscription {
	s := &domain.Subscription{
		ID: uuid.MustParse(id), UserID: uuid.MustParse(uid), Name: name, AmountMinor: amount, Currency: cur,
		Cadence: domain.Cadence(cad), NextDueAt: next, Status: domain.SubStatus(st), ReminderActive: rem != 0,
		CreatedAt: created, UpdatedAt: updated,
	}
	if anchor.Valid {
		v := int8(anchor.Int64)
		s.AnchorDay = &v
	}
	if lastPaid.Valid {
		t := lastPaid.Time
		s.LastPaidAt = &t
	}
	if lastRem.Valid {
		t := lastRem.Time
		s.LastReminderSentAt = &t
	}
	return s
}

// MarkSubscriptionReminderSent actualiza lembrete diário (data civil UTC).
func (s *Store) MarkSubscriptionReminderSent(ctx context.Context, subID, userID uuid.UUID, dayUTC time.Time) error {
	d := dayUTC.UTC().Format("2006-01-02")
	now := time.Now().UTC()
	_, err := s.DB.ExecContext(ctx,
		`UPDATE laele_finance_subscriptions SET last_reminder_sent_on = ?, reminder_active = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
		d, now, subID.String(), userID.String(),
	)
	return err
}

// UpdateDigestLastSentOn grava a data do último digest enviado (YYYY-MM-DD).
func (s *Store) UpdateDigestLastSentOn(ctx context.Context, userID uuid.UUID, dayUTC time.Time) error {
	d := dayUTC.UTC().Format("2006-01-02")
	now := time.Now().UTC()
	_, err := s.DB.ExecContext(ctx,
		`UPDATE laele_user_digest_settings SET last_digest_sent_on = ?, updated_at = ? WHERE user_id = ?`,
		d, now, userID.String(),
	)
	return err
}

// helpers
func nullableUUID(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}

func nullableInt8(v *int8) any {
	if v == nil {
		return nil
	}
	return *v
}

func nullableDate(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format("2006-01-02")
}

func boolTiny(b bool) int8 {
	if b {
		return 1
	}
	return 0
}

func scanCategories(rows *sql.Rows) ([]domain.Category, error) {
	var out []domain.Category
	for rows.Next() {
		var id, uid, name string
		var parent sql.NullString
		var sort int
		var created, updated time.Time
		if err := rows.Scan(&id, &uid, &parent, &name, &sort, &created, &updated); err != nil {
			return nil, err
		}
		c := domain.Category{
			ID: uuid.MustParse(id), UserID: uuid.MustParse(uid), Name: name, SortOrder: sort, CreatedAt: created, UpdatedAt: updated,
		}
		if parent.Valid {
			p := uuid.MustParse(parent.String)
			c.ParentID = &p
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func scanCategoryRow(row *sql.Row) (*domain.Category, error) {
	var id, uid, name string
	var parent sql.NullString
	var sort int
	var created, updated time.Time
	if err := row.Scan(&id, &uid, &parent, &name, &sort, &created, &updated); err != nil {
		return nil, err
	}
	c := &domain.Category{
		ID: uuid.MustParse(id), UserID: uuid.MustParse(uid), Name: name, SortOrder: sort, CreatedAt: created, UpdatedAt: updated,
	}
	if parent.Valid {
		p := uuid.MustParse(parent.String)
		c.ParentID = &p
	}
	return c, nil
}

func scanTransactions(rows *sql.Rows) ([]domain.Transaction, error) {
	var out []domain.Transaction
	for rows.Next() {
		t, err := scanTx(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func scanTx(scanner interface {
	Scan(dest ...any) error
}) (*domain.Transaction, error) {
	var id, uid, cur, dir, desc, src string
	var amount int64
	var catID, subID sql.NullString
	var occ, created time.Time
	if err := scanner.Scan(&id, &uid, &amount, &cur, &dir, &catID, &subID, &occ, &desc, &src, &created); err != nil {
		return nil, err
	}
	t := &domain.Transaction{
		ID: uuid.MustParse(id), UserID: uuid.MustParse(uid), AmountMinor: amount, Currency: cur,
		Direction: domain.Direction(dir), OccurredAt: occ, Description: desc, Source: domain.TxSource(src), CreatedAt: created,
	}
	if catID.Valid {
		c := uuid.MustParse(catID.String)
		t.CategoryID = &c
	}
	if subID.Valid {
		c := uuid.MustParse(subID.String)
		t.SubcategoryID = &c
	}
	return t, nil
}

func scanSubscriptions(rows *sql.Rows) ([]domain.Subscription, error) {
	var out []domain.Subscription
	for rows.Next() {
		s, err := scanSub(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func scanSub(scanner interface {
	Scan(dest ...any) error
}) (*domain.Subscription, error) {
	var id, uid, name, cur, cad, st string
	var amount int64
	var anchor sql.NullInt64
	var next, created, updated time.Time
	var lastPaid sql.NullTime
	var rem int8
	var lastRem sql.NullTime
	if err := scanner.Scan(&id, &uid, &name, &amount, &cur, &cad, &anchor, &next, &st, &lastPaid, &rem, &lastRem, &created, &updated); err != nil {
		return nil, err
	}
	return subscriptionFromScanned(id, uid, name, amount, cur, cad, anchor, next, st, lastPaid, rem, lastRem, created, updated), nil
}

func scanSubscriptionRow(row *sql.Row) (*domain.Subscription, error) {
	return scanSub(row)
}
