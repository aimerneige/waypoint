package httpapi

import (
	"context"
	"math"
	"math/big"
	"reflect"
	"regexp"

	"github.com/google/uuid"
	"waypoint/internal/db"
)

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
var ratePattern = regexp.MustCompile(`^\d{1,9}(\.\d{1,10})?$`)

func validCurrency(v any) bool   { s, ok := v.(string); return ok && currencyPattern.MatchString(s) }
func foreignCurrency(v any) bool { return validCurrency(v) && v != "CNY" }
func validRate(v any) bool {
	s, ok := v.(string)
	if !ok || !ratePattern.MatchString(s) {
		return false
	}
	n, ok := new(big.Rat).SetString(s)
	return ok && n.Sign() > 0
}
func positiveMoney(v any) bool {
	n, ok := v.(float64)
	return ok && n > 0 && n <= 9007199254740991 && math.Trunc(n) == n
}
func choice(values ...string) func(any) bool {
	return func(v any) bool {
		for _, s := range values {
			if v == s {
				return true
			}
		}
		return false
	}
}
func validSplit(v any) bool {
	m, ok := v.(map[string]any)
	if !ok || len(m) != 2 || m["mode"] != "equal" {
		return false
	}
	a, ok := m["members"].([]any)
	if !ok || len(a) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, v := range a {
		if !validUUID(v) || seen[v.(string)] {
			return false
		}
		seen[v.(string)] = true
	}
	return true
}
func init() {
	kinds, permission := entities["itinerary_item"].Kinds, entities["itinerary_item"].Permission
	common := func() map[string]FieldDef {
		return map[string]FieldDef{"date": {Required: true, Validate: validDate}, "time": {Nullable: true, Validate: validTime}, "note": {Nullable: true, Validate: stringField(0, 500)}}
	}
	exchange := common()
	exchange["ownerUserId"] = FieldDef{Required: true, Validate: validUUID}
	exchange["currency"] = FieldDef{Required: true, Validate: foreignCurrency}
	exchange["cnyPaid"] = FieldDef{Required: true, Validate: positiveMoney}
	exchange["foreignReceived"] = FieldDef{Required: true, Validate: positiveMoney}
	entities["exchange"] = EntityDef{Name: "exchange", Fields: exchange, Kinds: kinds, Permission: permission}
	expense := common()
	for k, d := range map[string]FieldDef{
		"title": {Required: true, Validate: stringField(1, 200)}, "category": {Nullable: true, Validate: choice("food", "transport", "lodging", "ticket", "shopping", "other")},
		"amount": {Required: true, Validate: func(v any) bool { return positiveMoney(v) && v.(float64) <= 1e12 }}, "currency": {Required: true, Validate: validCurrency}, "method": {Required: true, Validate: choice("card", "cash", "cny")},
		"payerUserId": {Required: true, Validate: validUUID}, "rateSource": {Required: true, Validate: choice("default", "wallet", "manual", "actual")},
		"rate": {Nullable: true, Validate: validRate}, "amountCny": {Nullable: true, Validate: positiveMoney}, "cardNote": {Nullable: true, Validate: stringField(0, 50)}, "split": {Required: true, Validate: validSplit},
	} {
		expense[k] = d
	}
	entities["expense"] = EntityDef{Name: "expense", Fields: expense, Kinds: kinds, Permission: permission}
	entities["settlement_transfer"] = EntityDef{Name: "settlement_transfer", Fields: map[string]FieldDef{
		"fromUserId": {Required: true, Validate: validUUID}, "toUserId": {Required: true, Validate: validUUID}, "amountCny": {Required: true, Validate: positiveMoney}, "date": {Required: true, Validate: validDate}, "note": {Nullable: true, Validate: stringField(0, 500)},
	}, Kinds: map[ClientOpKind]bool{ClientOpKindCreate: true, ClientOpKindDelete: true, ClientOpKindRestore: true}, Permission: permission}
	entities["trip_rates"] = EntityDef{Name: "trip_rates", Kinds: map[ClientOpKind]bool{ClientOpKindUpdate: true}, Permission: permission}
}

func (s *Server) validateLedgerState(ctx context.Context, q *db.Queries, op ClientOp, e db.EntityState, fields map[string]any) error {
	bad := func(message string) error { return fail(400, "invalid_op", message) }
	merged := make(map[string]any, len(fields)+len(op.Fields))
	for k, v := range fields {
		merged[k] = v
	}
	for k, v := range op.Fields {
		merged[k] = v
	}
	actor := op.ActorUserId.String()
	if op.Entity == "trip_rates" {
		if op.EntityId != op.TripId {
			return bad("默认汇率实体必须使用行程 ID")
		}
		return nil
	}
	if op.Entity == "exchange" {
		if op.Kind == ClientOpKindCreate && merged["ownerUserId"] != actor {
			return bad("只能为自己记录换汇")
		}
		if op.Kind != ClientOpKindCreate && e.CreatedBy != uid(op.ActorUserId) {
			return bad("只有创建者本人可修改换汇")
		}
		if merged["ownerUserId"] != actor {
			return bad("换汇所有者不可更改")
		}
	}
	if op.Entity == "expense" {
		if op.Kind == ClientOpKindCreate && merged["method"] == "cash" && merged["payerUserId"] != actor {
			return bad("现金付款人必须是本人")
		}
		if op.Kind != ClientOpKindCreate && (fields["method"] == "cash" || merged["method"] == "cash") && fields["payerUserId"] != actor {
			for _, k := range []string{"amount", "currency", "method", "payerUserId"} {
				if !reflect.DeepEqual(fields[k], merged[k]) {
					return bad("只有现金付款人本人可修改金额、币种、方式及付款人")
				}
			}
		}
		method, currency := merged["method"], merged["currency"]
		if method == "cny" && currency != "CNY" {
			return bad("人民币方式必须使用 CNY")
		}
		if method == "cash" && currency == "CNY" {
			return bad("现金方式不能使用 CNY")
		}
		if currency != "CNY" {
			if merged["rateSource"] == "manual" && !validRate(merged["rate"]) {
				return bad("手动汇率必填且必须大于零")
			}
			if merged["rateSource"] == "actual" && !positiveMoney(merged["amountCny"]) {
				return bad("实际人民币金额必填")
			}
			if merged["rateSource"] == "wallet" && method != "cash" {
				return bad("钱包成本仅适用于现金")
			}
			if method == "cash" && merged["rateSource"] == "default" {
				return bad("现金不能使用默认汇率")
			}
		}
		if merged["rateSource"] != "manual" && merged["rate"] != nil {
			return bad("只有手动来源可保存汇率")
		}
		if merged["rateSource"] != "actual" && merged["amountCny"] != nil {
			return bad("只有实际扣款来源可保存人民币金额")
		}
	}
	ids := []string{}
	switch op.Entity {
	case "expense":
		ids = append(ids, merged["payerUserId"].(string))
		split := merged["split"].(map[string]any)
		for _, id := range split["members"].([]any) {
			ids = append(ids, id.(string))
		}
	case "settlement_transfer":
		if merged["fromUserId"] == merged["toUserId"] {
			return bad("转账双方不能相同")
		}
		ids = append(ids, merged["fromUserId"].(string), merged["toUserId"].(string))
	}
	// 一次读取全部成员，含已退出成员，避免逐个校验产生 N+1 查询。
	if len(ids) > 0 {
		members, err := q.AllTripMembers(ctx, uid(op.TripId))
		if err != nil {
			return err
		}
		known := map[string]bool{}
		for _, m := range members {
			known[uuid.UUID(m.UserID.Bytes).String()] = true
		}
		for _, id := range ids {
			if !known[id] {
				return bad("付款人、分摊及转账双方必须是该行程成员")
			}
		}
	}
	return nil
}
