# Godot architecture: mechanisms for a small Electron app

Source: master branch, headers and a few .cpp files. Nothing here is from general knowledge unless marked.

## Mechanisms

**1. Layered directories with one-way includes, plus an explicit init order**
- What: The source is split into core, servers, scene, drivers/platform, main, and modules. Each layer is started and stopped in order by `main`.
- Where: the docs page "Godot's architecture overview" lists the layers and their paths (`/scene/*`, `/servers/*`, `/drivers/*`+`/platform/*`, `/core/*`, `/main/*`). In `main/main.cpp` the order is `register_core_types()`, `initialize_modules(CORE)`, `register_server_types()`, `initialize_modules(SERVERS)`, `register_scene_types()`, `initialize_modules(SCENE)`, `initialize_modules(EDITOR)`. `uninitialize_modules` runs in reverse. `core/object/object.h` and `servers/rendering/rendering_server.h` include no `scene/` or `editor/` headers (grep showed none). That the scene layer includes servers, never the reverse, is inferred from this and from the docs.
- Prevents: cycles, and low-level code that depends on UI.
- Transfer: use folders `core/` (pure functions, no Electron imports), `services/` (scanner, supervisor), `main/` (wiring), `renderer/`, `cli/`. Add a test or lint rule that fails when `core/` requires `electron` or `renderer/`. Make `main` the only file that starts services, and have it shut them down in reverse order.

**2. Declare once in a registry (ClassDB)**
- What: Each class lists its methods, properties, signals and constants once in `_bind_methods`. The editor, scripting, serialization and docs all read that registry.
- Where: `core/object/object.h` (`GDCLASS` macro, which wires in `_get_bind_methods`), `core/object/class_db.h` (`ClassDB::bind_method`, `add_signal`, `get_signal_list`, `BIND_ENUM_CONSTANT`, `BIND_CONSTANT`).
- Prevents: the same operation being described separately in IPC, CLI help, docs and validation, which then drift apart.
- Transfer: write one `operations` table. Each entry has a name, input schema, output schema, a side-effect flag, and a handler. Generate from it the `ipcMain.handle` registrations, the preload bridge, the CLI commands, `capabilities` output and docs. The renderer then can't call anything that isn't in the table.

**3. Signals for notifying, deferred calls for crossing a safety boundary**
- What: `connect` and `emit_signal` decouple the emitter from its listeners. `CONNECT_DEFERRED` and `call_deferred` push the call onto a queue that runs at a safe point in the frame.
- Where: `core/object/object.h` (`connect`, `emit_signalp`, `CONNECT_DEFERRED`, `CONNECT_ONE_SHOT`, `call_deferredp`). `core/object/message_queue.h` has `CallQueue` with `push_callp`, `push_set`, `push_notification`, and `MessageQueue` on top.
- Prevents: re-entrancy bugs, such as a handler mutating a list while it is being iterated or drawn.
- Transfer: give the scanner and supervisor a small typed event emitter. Renderer-side state changes only through a queue that is flushed once per animation frame, so scan results never rewrite the DOM mid-draw. Use `queueMicrotask` or a "dirty" set for this.

**4. Servers behind a command queue, opaque RID handles**
- What: The scene never touches rendering state. It sends commands to a server singleton, which can run them on another thread. Objects are referred to by an opaque RID.
- Where: `servers/rendering/rendering_server.h` (`get_singleton`, `create`, `create_func`). `servers/rendering/rendering_server_default.h` (`CommandQueueMT command_queue`, `_thread_loop`, `FUNC*` macros that either push a command or call directly, and `MAIN_THREAD_SYNC_WARN`, which warns that a sync call hurts performance). `core/templates/command_queue_mt.h` (`CommandQueueMT`, `Command`, `CommandRet`, which is a sync command carrying a return value). `core/templates/rid_owner.h` (`RID_Owner`, `make_rid`, `get_or_null`).
- Prevents: shared mutable state across threads. Also stale handles: in `rid_owner.h` each RID carries a `validator` generation number, and `get_or_null` returns null when it doesn't match.
- Transfer: the main-process scanner and supervisor form the server. The renderer sends commands and holds only opaque IDs (`run:7f3a`), never paths, PIDs or objects. A stale ID returns "gone", not a crash. Fire-and-forget commands are the default; request/response is the exception, and you can log a warning when the renderer awaits too often.

**5. Reference-counted resources with a cache keyed by path**
- What: Resources are `RefCounted`, held through `Ref<T>`. A cache keeps one instance per path, and loaders and savers are registered per format.
- Where: `core/object/ref_counted.h` (`reference`, `unreference`, `Ref`). `core/io/resource.h` (`Resource::set_path`, `emit_changed`, `ResourceCache::has`). `core/io/resource_loader.h` (`ResourceFormatLoader` with `get_recognized_extensions`, `recognize_path`, `handles_type`, `load`; `CacheMode` of IGNORE, REUSE, REPLACE).
- Prevents: duplicate copies of the same file with divergent state, and loading logic scattered across callers.
- Transfer: one `loadRecord(path)` per file type, with a `Map<path, record>` in main and a `changed` event. A per-format parser list (`{extensions, recognize, parse}`) means adding a format never edits the scanner. Make "reuse or replace cache" an explicit parameter for rescans.

**6. Main loop with separate process and physics steps, and a delete queue**
- What: `SceneTree` is a `MainLoop` with `process(delta)` and `physics_process(delta)`. Nodes receive `NOTIFICATION_*` constants. `queue_free` puts a node in a delete queue that is flushed at a safe time.
- Where: `core/os/main_loop.h` (`process`, `physics_process`). `scene/main/scene_tree.h` (`delete_queue`, `_flush_delete_queue`, `_process(bool p_physics)`, groups via `add_to_group`, `call_group`). `scene/main/node.h` (`NOTIFICATION_ENTER_TREE`, `EXIT_TREE`, `READY`, `PAUSED`, `PROCESS`, `PHYSICS_PROCESS`; `PROCESS_MODE_PAUSABLE/ALWAYS/DISABLED`; `queue_free`).
- Prevents: freeing an object that is still on the call stack, and uncontrolled per-object timers.
- Transfer: one `requestAnimationFrame` loop owns all sprite animation, with a fixed-step update for animation state separate from the render step. Items have lifecycle hooks (`enter`, `exit`, `ready`) and are removed by marking them and sweeping after the frame. Pausing is a mode on the item (`PAUSABLE/ALWAYS/DISABLED`), not scattered `if (hidden)` checks. Groups map to tags: "redraw everything tagged `running`".

**7. Modules register themselves at named init levels**
- What: An optional feature lives in `modules/<name>/` and exposes `initialize_<name>_module(level)` and `uninitialize_<name>_module(level)`. Core doesn't know modules exist.
- Where: `modules/register_module_types.h` (`ModuleInitializationLevel` CORE, SERVERS, SCENE, EDITOR). `modules/gdscript/register_types.cpp`: at the SERVERS level it calls `ResourceLoader::add_resource_format_loader` and `ResourceSaver::add_resource_format_saver`; editor-only parts sit behind `#ifdef TOOLS_ENABLED`. `modules/SCsub` loops over the module list and generates `register_module_types.gen.cpp` and `modules_enabled.gen.h`.
- Prevents: a core that must edit its own files to add a feature, and that can't build without a feature.
- Transfer: each account type or provider is `providers/<name>/index.js` exporting `register(registry, level)`. A generated or static list calls them. A provider adds its loader, operations and CLI commands to the registries from mechanisms 2 and 5. Deleting a folder removes the provider.

**8. Typed, declared settings with a single read path**
- What: A setting is declared where it is first used with a default and a type/range hint. All reads go through the same macro.
- Where: `core/config/project_settings.h` (`GLOBAL_DEF`, `GLOBAL_DEF_RST` where RST means restart needed, `GLOBAL_DEF_BASIC`, `GLOBAL_GET`, `set_custom_property_info`, `set_initial_value`). Example in `main/main.cpp`: `physics/common/physics_ticks_per_second` with `PropertyInfo(Variant::INT, ..., PROPERTY_HINT_RANGE, "1,1000,1")` and default 60.
- Prevents: undocumented keys, defaults repeated in many places, and a UI that doesn't know a setting's type.
- Transfer: one `settings.js` declares `{key, type, default, range, restartRequired, secret}`. Reads return the default when unset. The UI form, CLI `settings get/set` and validation all come from that file. Never store a secret in it (`secret: true` means "pointer only").

**9. Singletons for the engine's services, created through a factory**
- What: Services are singletons held in one place, and platform implementations register a create function.
- Where: `core/config/engine.h` (`add_singleton`, `get_singleton_object`, `has_singleton`). `servers/display/display_server.h` (`register_create_function`, `create_function_count`, `DisplayServerCreate server_create_functions[]`).
- Prevents: hard-coded platform branches and hidden global construction.
- Transfer: a `services` object, built in `main`, holds `scanner`, `supervisor`, `settings`, `registry`. It is passed to handlers as an argument, so tests substitute fakes. Platform differences (macOS/Windows process-kill, paths) are one factory chosen at start.

## Do NOT copy
- Custom reference counting, deep node trees and GDExtension-style plugin ABIs.
- A custom Variant type system and reflection of every call. Plain JSON schemas are enough.
- A multithreaded render server and lock-free command pages. One main process plus renderer needs only an ordered message queue.
- The SCons-generated module list and `#ifdef` build flavours. A static array of providers is fine.
- Error macros that return early everywhere; a small `guard(cond, code)` helper with fixed reason codes is enough.

## URLs actually fetched (HTTP 200)
https://raw.githubusercontent.com/godotengine/godot/master/ plus: core/object/object.h, core/object/class_db.h, core/object/message_queue.h, core/object/ref_counted.h, core/templates/command_queue_mt.h, core/templates/rid_owner.h, servers/rendering/rendering_server.h, servers/rendering/rendering_server_default.h, servers/display/display_server.h, core/io/resource.h, core/io/resource_loader.h, scene/main/scene_tree.h, scene/main/node.h, core/os/main_loop.h, core/config/project_settings.h, core/config/engine.h, main/main.cpp, modules/register_module_types.h, modules/gdscript/register_types.cpp, modules/SCsub.
Docs: https://docs.godotengine.org/en/stable/engine_details/architecture/godot_architecture_diagram.html and .../core_types.html (RID section only).

## Not fetched
- `servers/rendering_server.h` (404; the real path is `servers/rendering/rendering_server.h`) and `modules/enabled.h` (404).
- The old docs paths under `contributing/development/core_and_modules/...` returned 404. The pages moved to `engine_details/architecture/`.
- Not verified: bodies of `emit_signalp`, `flush`, `queue_free`.
