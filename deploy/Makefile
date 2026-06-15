# Stwrd — operator Makefile (spec §19.2).
# Run from the deploy/ directory. Wraps the first-run and day-2 procedures.

COMPOSE ?= docker compose
REPO_ROOT := $(shell cd .. && pwd)

.PHONY: help up down logs ps admin-key deploy env-set-secret backup restore

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Bring up the full stack (detached)
	$(COMPOSE) up -d

down: ## Stop the stack (volumes preserved)
	$(COMPOSE) down

logs: ## Tail logs for all services
	$(COMPOSE) logs -f

ps: ## Show service status
	$(COMPOSE) ps

admin-key: ## Generate a Convex admin key (store it securely; §19.2 step 3)
	$(COMPOSE) exec backend ./generate_admin_key.sh

deploy: ## Push Convex functions/schema to the running backend (§19.2 step 4)
	@test -n "$$CONVEX_SELF_HOSTED_URL" || (echo "Set CONVEX_SELF_HOSTED_URL"; exit 1)
	@test -n "$$CONVEX_SELF_HOSTED_ADMIN_KEY" || (echo "Set CONVEX_SELF_HOSTED_ADMIN_KEY"; exit 1)
	cd $(REPO_ROOT) && npx convex deploy

env-set-secret: ## Set APP_SECRETS_KEY on the backend (§19.1). Usage: make env-set-secret KEY=...
	@test -n "$(KEY)" || (echo "Usage: make env-set-secret KEY=<value>"; exit 1)
	cd $(REPO_ROOT) && npx convex env set APP_SECRETS_KEY "$(KEY)"

backup: ## Nightly consistent snapshot of tables + file storage (§18.4)
	cd $(REPO_ROOT) && npx convex export --path ./backups/snapshot-$$(date +%Y%m%d-%H%M%S).zip

restore: ## Restore from a snapshot. Usage: make restore SNAPSHOT=path.zip (§18.4)
	@test -n "$(SNAPSHOT)" || (echo "Usage: make restore SNAPSHOT=<file.zip>"; exit 1)
	cd $(REPO_ROOT) && npx convex import --replace "$(SNAPSHOT)"
