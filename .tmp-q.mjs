import pg from 'pg'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()]}))
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
const r = await c.query(process.argv.slice(2).join(' '))
console.log(JSON.stringify(r.rows, null, 1))
await c.end()
