# Database backups

Two kinds, for different disasters.

| | Supabase daily backups | `db-backup` (GitHub Actions) |
|---|---|---|
| **Use it when** | Something went wrong in the last week and the project still exists | The project or account is gone, or the damage is older than a week |
| **Kept** | 7 days | 90 days |
| **Holds** | The whole database | `public`, `auth`, `storage`, and `cron.job` as a CSV |
| **Restore** | Supabase dashboard, Database, Backups. It overwrites the project | Below, into a new project |

Point-in-time recovery is off, so either kind can lose up to a day.

## The nightly job

[`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml) runs at 09:41 UTC. It dumps the
database, encrypts the dump to [`scripts/backup/public-key.asc`](../scripts/backup/public-key.asc), stores
it as the run's `db-backup` artifact, then restores the unencrypted dump into a scratch Postgres and
compares every table's row count with live
([`verify-restore.sh`](../scripts/backup/verify-restore.sh)). A failure pages through
`workflow-failure-alert`.

The repo is public, so anyone signed in to GitHub can download the artifact. That is why it is encrypted
and why the script's logs carry no rows.

## The private key

Fingerprint `01F2099D718BB909E8B28C2077DBAEEC248EDB75`. **Only the owner holds it, and without it every
backup is unreadable.** Keep it in a password manager, not only on one computer. It has no passphrase of its
own, so whatever holds it is its protection.

If it is lost or leaks: make a new key pair, replace the public key in the repo, and treat the backups made
with the old key as unreadable or exposed. They expire within 90 days.

```bash
export GNUPGHOME=$(mktemp -d)
gpg --batch --passphrase '' --quick-generate-key "sportydolphin.fun database backups" ed25519 cert never
FPR=$(gpg --list-keys --with-colons | awk -F: '/^fpr/{print $10; exit}')
gpg --batch --passphrase '' --quick-add-key "$FPR" cv25519 encr never
gpg --armor --export "$FPR" > scripts/backup/public-key.asc
gpg --armor --batch --pinentry-mode loopback --passphrase '' --export-secret-keys "$FPR" > private-key.asc
```

## Restoring into a new project

Needs the Postgres 17 client, and the new project's direct connection string as `NEW_DB_URL`.

```bash
gh run list --workflow db-backup.yml --status success --limit 5
gh run download <run id> -n db-backup
gpg --import private-key.asc
gpg --output backup.tar --decrypt db-backup-<date>.tar.gpg
tar -xf backup.tar
pg_restore --dbname="$NEW_DB_URL" --no-owner --clean --if-exists --schema=public db.dump
pg_restore --dbname="$NEW_DB_URL" --no-owner --data-only --disable-triggers --schema=auth db.dump
```

A new project already has its own `auth` tables, so that schema goes in as data alone. Accounts keep working
because the password hashes come with it.

Then, by hand, because none of this is in the dump:

1. Recreate the jobs in `cron-jobs.csv`.
2. Put the Vault secrets back (`vault.secrets`; they are encrypted with the old project's key).
3. Deploy the edge functions and set their secrets (ARCHITECTURE §9).
4. Point `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and the GitHub secrets, at the new project.
5. Sign-in: add the new callback URL to the Google OAuth client.

**What has been tested:** every night, the restore into plain Postgres and the row counts. On Oct 31, 2026,
one artifact downloaded and decrypted with the private key. **What has not:** the two `pg_restore` lines above
against a real new Supabase project, and steps 1 to 5.
