import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const file = arg('file');
const sqlArg = arg('sql');
const output = arg('output') || 'text';
const host = arg('host') || 'aws-0-us-west-2.pooler.supabase.com';
const projectRef = arg('project-ref') || 'ionljrbrvulbmscodtzg';
const sshTarget = arg('ssh') || 'aros-vps';
const password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS || '';

if (!password) throw new Error('SUPABASE_DB_PASSWORD is required in the environment');
if (!file && !sqlArg) throw new Error('Provide --file <path> or --sql <statement>');

const sql = file ? readFileSync(file, 'utf8') : sqlArg!;
const psqlOutputFlags = output === 'csv' ? '-t -A -F ,' : '-P pager=off';
const uri = `postgresql://postgres.${projectRef}@${host}:5432/postgres?sslmode=require`;
const remote = [
  'read -r PGPASSWORD',
  'export PGPASSWORD',
  `docker run --rm -i -e PGPASSWORD -e PGHOST='${host}' -e PGPORT='5432' -e PGDATABASE='postgres' -e PGUSER='postgres.${projectRef}' -e PGSSLMODE='require' postgres:16-alpine psql -v ON_ERROR_STOP=1 ${psqlOutputFlags}`,
].join('; ');

const result = spawnSync('ssh', [sshTarget, remote], {
  input: `${password.trimEnd()}\n${sql}`,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.status ?? 1;
