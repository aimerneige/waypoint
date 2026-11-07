.PHONY: gen dev-db test test-integration lint build up down e2e
gen:
	cd api && go tool oapi-codegen -config oapi-codegen.yaml ../openapi/openapi.yaml
	cd api && go tool sqlc generate
	cd web && npm run gen
dev-db:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait postgres
test-integration: dev-db
	docker compose exec -T postgres sh -c 'psql -U "$$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '\''waypoint_test'\''" | grep -q 1 || createdb -U "$$POSTGRES_USER" waypoint_test'
	docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile test run --rm gotest go test -race -count=1 -v ./...
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
e2e:
	docker compose --profile dev up -d --build --wait
	cd web && npx playwright test
