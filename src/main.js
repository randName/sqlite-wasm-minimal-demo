import * as sqlite from './core.js'
import { peek_ptr, cstr_to_js as _s, alloc_str_template as s } from './core.js'

const app = document.querySelector('#app')

const log = (msg) => {
	app.innerHTML += `${msg}`
}

log('started\n\n')
sqlite.load().then((asm) => {
	log(`version: ${_s(asm.sqlite3_libversion())}\n`)
	log(`source ID: ${_s(asm.sqlite3_sourceid())}\n`)

	const memPtr = s`:memory:`
	const stack = sqlite.pstack_ptr()
	/** @type {number} */
	let pDb
	try {
		const pPtr = sqlite.pstack_alloc(8)
		const open_rc = asm.sqlite3_open_v2(memPtr, pPtr, 4 | 2, null)
		if (open_rc) abort(`open error ${open_rc}`)
		pDb = peek_ptr(pPtr)
		if (!pDb) abort('could not find db')
	} finally {
		sqlite.dealloc(memPtr)
		sqlite.pstack_restore(stack)
	}

	log(`\nopened db @ ${pDb}\n\n`)

	const initSqlPtr = s`CREATE TABLE IF NOT EXISTS foo(name, bar);
	INSERT INTO foo (name, bar) VALUES ('a', 'sdf'), ('b', 'zza')`
	try {
		const exec_rc = asm.sqlite3_exec(pDb, initSqlPtr, 0, 0, 0)
		if (exec_rc) abort(`exec error ${exec_rc}`)
		log(`inited db and inserted rows\n\n`)
	} finally {
		sqlite.dealloc(initSqlPtr)
	}

	const resultCallback = (_, cols, vals, names) => {
		log(`got result row: `)
		const entries = Array.from({ length: cols }, (_, i) => {
			const off = 4 * i
			return [_s(peek_ptr(names + off)), _s(peek_ptr(vals + off))]
		})
		log(`${JSON.stringify(Object.fromEntries(entries))}\n`)
	}

	const pFunc = sqlite.install_function(resultCallback, 'i(pipp)')
	const querySqlPtr = s`SELECT * FROM foo`
	try {
		const exec_rc = asm.sqlite3_exec(pDb, querySqlPtr, pFunc, 0, 0)
		if (exec_rc) abort(`exec error ${exec_rc}`)
	} finally {
		sqlite.dealloc(querySqlPtr)
	}

	log('\ndone')
})
