/** @type {WebAssembly.Instance | null} */
let instance = null

const ENCODER = new TextEncoder('utf8')
const DECODER = new TextDecoder('utf8')

const typeCodes = { f64: 0x7c, f32: 0x7d, i64: 0x7e, i32: 0x7f }
/** @param {keyof typeCodes} x */
const typeCode = (x) => typeCodes[x]
/** @param {number} n */
const encodeBytes = (n) => (n < 128 ? [n] : [n % 128, n >> 7])

/**
 * create a funcref for the function table
 * 
 * stand-in for the upcoming `WebAssembly.Function` constructor
 * 
 * @param {Function} func
 * @param {keyof typeCodes | null} resultType
 * @param {...keyof typeCodes} argTypes
 */
const to_funcref = (func, resultType, ...argTypes) => {
	// prettier-ignore
	const typeSection = [
		// 1 func
		0x01, 0x60,
		// arg types
		...encodeBytes(argTypes.length), ...argTypes.map(typeCode),
		// result type
		...(resultType === null ? [0x00] : [0x01, typeCode(resultType)]),
	]

	// prettier-ignore
	const bytecode = new Uint8Array([
		// magic number (ASM)
		0x00, 0x61, 0x73, 0x6d,
		// version
		0x01, 0x00, 0x00, 0x00,
		// type section
		0x01, ...encodeBytes(typeSection.length), ...typeSection,
		// import "e" "f" (func $e.f (type $t0))
		0x02, 0x07, 0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,
		// export "f" (func $e.f)
		0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00,
	])

	const mod = new WebAssembly.Module(bytecode)
	return new WebAssembly.Instance(mod, { e: { f: func } }).exports.f
}

/**
 * create a shim for the importObject (to prevent LinkError)
 * 
 * @param {unknown} target
 * @param {string} name
 */
const importShim = (target, name) => {
	const unimplemented = (p) => {
		return () => {
			throw new Error(`${name}.${p} was called but not implemented`)
		}
	}

	return new Proxy(target, {
		get(tgt, prop) {
			// console.warn(`${name}.${prop} was accessed`)
			return tgt[prop] ?? unimplemented(prop)
		},
	})
}

export const memory = new WebAssembly.Memory({ initial: 256, maximum: 32768 })

export const heap = new Uint8Array(memory.buffer)
export const heap32 = new Int32Array(memory.buffer)

export const load = async (source) => {
	if (!source) {
		source = fetch('/sqlite3.wasm')
	}

	/**
	 * currently only 1 layer of shims are created.
	 * there is a risk that emscripten might change the import surface,
	 * but not of great concern for now.
	 */
	const src = await WebAssembly.instantiateStreaming(source, {
		env: importShim({ memory }, 'env'),
		wasi_snapshot_preview1: importShim({}, 'wasi'),
	})
	instance = src.instance

	return instance.exports
}

/**
 * @param {string} msg
 * @param {unknown} [cause]
 */
export const abort = (msg, cause) => {
	throw new Error(msg, { cause })
}

/**
 * get the exports object. throws if load() was not called
 */
export const getASM = () => instance?.exports ?? abort('not initialized')

/**
 * seek to the end of a NUL terminated C string
 * @param {number} ptr
 */
const cstrend = (ptr) => {
	while (heap[++ptr] !== 0) {}
	return ptr
}

/**
 * get the char length of a C string
 * @param {number} ptr
 */
export const cstrlen = (ptr) => {
	return ptr - cstrend(ptr)
}

/**
 * read the value of a C string
 * @param {number} ptr
 */
export const cstr_to_js = (ptr) => {
	const end = cstrend(ptr)
	return ptr === end ? '' : DECODER.decode(heap.slice(ptr, end))
}

/**
 * @param {number} n
 * @return {number}
 */
export const alloc = (n) => {
	return getASM().sqlite3_malloc(n) || abort(`alloc(${n}) failed`)
}

/**
 * @param {number} n
 * @return {void}
 */
export const dealloc = (n) => getASM().sqlite3_free(n)

/**
 * @param {number} m
 * @param {number} n
 * @return {number}
 */
export const realloc = (m, n) => {
	if (!n) return 0
	return getASM().sqlite3_realloc(m, n) || abort(`realloc(${n}) failed`)
}

/**
 * @param {number} ptr
 */
export const peek_ptr = (ptr) => heap32[ptr >> 2]

/** @return {WebAssembly.Table} */
export const function_table = () => getASM().__indirect_function_table

/**
 * @param {Function} func
 * @param {keyof typeCodes | null} resultType
 * @param {...keyof typeCodes} argTypes
 */
export const install_function = (func, resultType, ...argTypes) => {
	const ft = function_table()
	const ptr = ft.length
	ft.grow(1)
	ft.set(ptr, to_funcref(func, resultType, ...argTypes))
	return ptr
}

/**
 * copy a string into the WASM heap
 * 
 * @param {string} str
 * @param {number} [ptr]
 * @param {number} [max]
 */
export const alloc_str = (str, ptr, max) => {
	const raw = ENCODER.encode(str)
	const len = max > 0 ? Math.min(max, raw.length) : raw.length
	if (!ptr) {
		ptr = alloc(len + 1)
	}
	heap.set(raw, ptr)
	heap[ptr + len] = 0
	return /** @type {[ptr: number, len: number]} */ ([ptr, len])
}

/**
 * convenience template tag
 * 
 * @param {string[]} strs
 * @param {...unknown} vals
 */
export function alloc_str_template(strs, ...vals) {
	const all = strs.slice(1).reduce((s, v, i) => s + vals[i] + v, strs[0])
	return alloc_str(all)[0]
}

/**
 * @param {number} n
 * @return {number}
 */
export const pstack_alloc = (n) => {
	return (
		getASM().sqlite3_wasm_pstack_alloc(n) || abort(`pstack.alloc(${n}) failed`)
	)
}

/** @return {number} */
export const pstack_ptr = () => getASM().sqlite3_wasm_pstack_ptr

/**
 * @param {number} n
 * @return {void}
 */
export const pstack_restore = (n) => getASM().sqlite3_wasm_pstack_restore(n)
