#!/usr/bin/env bash
# One-off column additions for databases created before these columns existed.
# Each step fails harmlessly ("duplicate column") once it has been applied.
cd "$(dirname "$0")"
run() { npx wrangler d1 execute bmtc-roster "$@" --command "$CMD" || echo "(already applied)"; }
# 2026-11-03: core team (sees everyone's leave) + BMTC event times
CMD="alter table instructors add column is_core integer not null default 0; update instructors set is_core = 1 where lower(name) in ('haziq','antonio','rizqan','wesley','vikenesh','zaki','keith');" run "$@"
CMD="alter table assignments add column info text;" run "$@"
exit 0
