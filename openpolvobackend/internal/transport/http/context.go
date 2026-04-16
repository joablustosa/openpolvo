package httptransport

import "context"

type ctxKey int

const ctxUserID ctxKey = 1
const ctxUserEmail ctxKey = 2

func WithUser(ctx context.Context, userID string, email string) context.Context {
	ctx = context.WithValue(ctx, ctxUserID, userID)
	return context.WithValue(ctx, ctxUserEmail, email)
}

func UserFromContext(ctx context.Context) (id string, email string, ok bool) {
	id, ok = ctx.Value(ctxUserID).(string)
	if !ok {
		return "", "", false
	}
	email, _ = ctx.Value(ctxUserEmail).(string)
	return id, email, true
}
