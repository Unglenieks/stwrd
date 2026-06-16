# Stwrd — operator Makefile (spec §19.2).
# Run from the deploy/ directory.

COMPOSE         ?= docker compose
QUICKSTART_ARGS := -f docker-compose.quickstart.yml --env-file .env.quickstart
REPO_ROOT       := $(shell cd .. && pwd)

.PHONY: help setup-env up up-quickstart down logs ps bootstrap-logs backup restore

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── First-run setup ───────────────────────────────────────────────────────────

setup-env: ## Generate .env from SITE_ORIGIN. Usage: make setup-env SITE_ORIGIN=https://library.example.org
	@test -n "$(SITE_ORIGIN)" || { echo "Usage: make setup-env SITE_ORIGIN=https://library.example.org"; exit 1; }
	@HOSTNAME=$$(printf '%s' '$(SITE_ORIGIN)' | sed 's|https\?://||' | cut -d/ -f1); \
	 INSTANCE_NAME=$$(openssl rand -hex 6); \
	 INSTANCE_SECRET=$$(openssl rand -hex 32); \
	 sed \
		-e "s|^SITE_ORIGIN=.*|SITE_ORIGIN=$(SITE_ORIGIN)|" \
		-e "s|^CONVEX_CLOUD_ORIGIN=.*|CONVEX_CLOUD_ORIGIN=$(SITE_ORIGIN)/api|" \
		-e "s|^PROXY_HOSTNAME=.*|PROXY_HOSTNAME=$$HOSTNAME|" \
		-e "s|^INSTANCE_NAME=.*|INSTANCE_NAME=$$INSTANCE_NAME|" \
		-e "s|^INSTANCE_SECRET=.*|INSTANCE_SECRET=$$INSTANCE_SECRET|" \
		.env.example > .env; \
	 echo "Generated .env for $(SITE_ORIGIN)"; \
	 echo "Next: edit .env to set ACME_EMAIL and optionally ORG_NAME, then: make up"

# ── Stack management ──────────────────────────────────────────────────────────

up: ## Start the production stack (detached). Run make setup-env first.
	$(COMPOSE) up -d

up-quickstart: ## Start the localhost quickstart stack (no domain or TLS needed)
	$(COMPOSE) $(QUICKSTART_ARGS) up -d

down: ## Stop the stack (data volume preserved)
	$(COMPOSE) down

logs: ## Tail all service logs
	$(COMPOSE) logs -f

ps: ## Show container status
	$(COMPOSE) ps

bootstrap-logs: ## Show bootstrap output (credentials are here on first run)
	$(COMPOSE) logs bootstrap

# ── Day-2 operations ──────────────────────────────────────────────────────────

backup: ## Snapshot all data + file storage to ./backups/ (run nightly via cron)
	mkdir -p $(REPO_ROOT)/backups
	cd $(REPO_ROOT) && npx convex export \
		--path ./backups/snapshot-$$(date +%Y%m%d-%H%M%S).zip

restore: ## Restore from a snapshot. Usage: make restore SNAPSHOT=path.zip
	@test -n "$(SNAPSHOT)" || { echo "Usage: make restore SNAPSHOT=<file.zip>"; exit 1; }
	cd $(REPO_ROOT) && npx convex import --replace "$(SNAPSHOT)"
