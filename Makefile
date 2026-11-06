.PHONY: gen dev-db test lint build up down
gen:
	cd api && go tool oapi-codegen -config oapi-codegen.yaml ../openapi/openapi.yaml
	cd api && go tool sqlc generate
	cd web && npm run gen
dev-db:
	docker compose up -d postgres
test:
	cd api && go test ./...
	cd web && npm run test -- --run
lint:
	cd api && go vet ./...
	cd web && npm run lint
build:
	cd api && CGO_ENABLED=0 go build -o bin/api ./cmd/api
	cd web && npm run build
up:
	docker compose up -d --build
down:
	docker compose down
