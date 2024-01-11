# SQLite WASM minimal demo

[Open in StackBlitz](https://stackblitz.com/github/randName/sqlite-wasm-minimal-demo)

This is a small demo of using the [official WASM build of SQLite](https://sqlite.org/wasm/doc/trunk/index.md) but without the [wrapper JS code](https://github.com/sqlite/sqlite-wasm) that comes with it

## Background

Currently, the official build provides [many interfaces](https://sqlite.org/wasm/doc/trunk/api-index.md) but unfortunately the JS code comes in [a giant IIFE](https://github.com/sqlite/sqlite-wasm/blob/main/sqlite-wasm/jswasm/sqlite3-bundler-friendly.mjs) that is impossible to tree-shake. This will be hard (but not technically impossible) to change due to a few factors:

- the SQLite team does not interact with the current ecosystem of JS tools (besides [emscripten](https://emscripten.org/)) and thus will not be able to keep up with the latest JS fads
- SQLite is [not open-contribution](https://sqlite.org/copyright.html) and thus one cannot simply contribute code upstream
- While the [`@sqlite.org/sqlite-wasm`](https://github.com/sqlite/sqlite-wasm/) repo accepts contributions, there is a (albeit small) risk that changes in the emscripten build breaks the downstream implementation since they will not be directly related

Thankfully, the SQLite team encourages alternate implementations, and projects like [wa-sqlite](https://github.com/rhashimoto/wa-sqlite/) and [sql.js](https://github.com/sql-js/sql.js) exist. However, not everyone is able to [setup a build environment](https://sqlite.org/wasm/doc/trunk/building.md) and thus this demo focuses on using the existing build

## Using the module

There are some things to handle when using the `sqlite3.wasm` module in JS

### creating `Memory` and providing imports

A [`WebAssembly.Memory`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory) object needs to be created and provided when initialising the module via [`instantiateStreaming()`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/instantiateStreaming_static). Some other imports also need to be provided or `LinkError`s will be thrown

The current shape of the `importObject` parameter looks something like this

```js
const memory = new WebAssembly.Memory({
  initial: 256, // values from the original wrapper
  maximum: 32768,
})

const src = await WebAssembly.instantiateStreaming(source, {
  env: {
    memory, // the memory object
    __syscall_getcwd: (ptr, size) => { /* */ },
    /* other __syscall_* functions */
  },
  wasi_snapshot_preview1: {
    fd_close: (fd) => { /* */ },
    /* other fd_* functions */
  },
})
```

Many of the functions are not used unless the relevant APIs are called, and thus it is sufficient to replace them with no-ops. One way is to use a [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy), which also helps with handling unknown keys (protecting you from potential changes to the build). An implementation is shown in the demo

### sending and receiving strings

> Note: there is [a proposal](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md) to eventually handle this natively

The exported WASM functions usually take in and return pointers to strings, which need to be converted from and to JS strings

In this demo

- string ➡️ pointer is handled by `alloc_str`
- pointer ➡️ string is handled by `cstr_to_js`

A helper that uses a [tagged template](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#tagged_templates) (`alloc_str_template`) is also shown

### struct info and `SQLITE_*` constants

The WASM build exposes the [constants](https://sqlite.org/c3ref/constlist.html) and struct member information via `sqlite3_wasm_enum_json`. The exposed object requires some processing, but should be simple to implement (not shown in the demo). Beware that the `.structs` value is an array and not an object like the others, see the [C structs](#c-structs) section for more details

However, for bundling and minification purposes (see the [tree-shaking](#tree-shakable-functions) section) it can be desirable to define constants explicitly in JS. In that case, it should be sufficient to compare the values only when updating the binary or packaging a release, instead of loading them at runtime

### providing JS functions

There are API calls that take in a function pointer as a callback, and some structs have function members. To refer to JS functions from WASM, it needs to be converted into a `funcref` and stored in the `__indirect_function_table`

A new [`WebAssembly.Function`](https://github.com/WebAssembly/js-types/blob/main/proposals/js-types/Overview.md#addition-of-webassemblyfunction) class will help with this, but in the meantime the demo shows the `to_funcref` and `install_function` utilities

## Additional notes

some other things to highlight from the demo

### tree-shakable functions

Due to the reliance on the exported object from WebAssembly, it can be tricky to create "pure" functions that can be dropped by a bundler if unused

One way is to use a [top-level `await`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await#top_level_await) in a ES module, but the instantiation options cannot be modified once the module is loaded

The other would be to use a module singleton and a getter to ensure that it is loaded before use. This is shown with the `getASM` utility (implementation note: the naming is to reduce confusion between the [`export`](https://developer.mozilla.org/en-US/docs/web/javascript/reference/statements/export) keyword and the [`.exports`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Instance/exports) property, and also for brevity)

### C structs

> this is currently handled by [Jaccwabyt](https://fossil.wanderinghorse.net/r/jaccwabyt/wiki/home) in the official wrapper

TODO

### using a VFS

> [other persistence modes](https://sqlite.org/wasm/doc/trunk/persistence.md) are possible but will not be shown

TODO

## References

- [the original discussion](https://sqlite.org/forum/forumpost/0aafbc16b720cf74) that led to this demo
