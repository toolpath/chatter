---
name: add-machine-type
description: Adds a new CNC control type to Chatter (a new connector, for example Okuma OSP or Mazak), from the server connector to the screens, the network scan, a fake machine and the docs. Use when the user wants Chatter to read a control or protocol that it does not support yet.
---

# Add a machine type

A machine type touches about 30 files in the server, the web app, `packages/shared`, the fake machines and the docs. The newest type is your **template**: today that is `siemens` (added in one change, with tests). Follow its trail. The template skipped three things that a new type still needs: a fake machine, a case in `connector.schema.test.ts`, and its lines in `docs/api/history.md`.

## 1. Know the protocol first

Before you write code, write down for the user:
- The port and the protocol, and the control models and options that it needs.
- Which of these values the control can send: run state, mode, program, spindle speed, spindle load, feed rate, tool, part count, part goal, alarms, emergency stop.
- The **license** of each library and each source that you use. Chatter is MIT. Use only libraries with an MIT-compatible license. From a GPL or AGPL project, take only facts (addresses, variable names), never code. A closed vendor library (as FANUC FOCAS2 is) never goes in the repo or the image: the user uploads it, as in `docs/guide/fanuc.md`.

Done when the user agrees with the list of values and the libraries.

## 2. Find every place

```bash
git grep -n -i "siemens" -- ':!package-lock.json'
```

Each hit outside `apps/server/src/machines/siemens/` is a place that the new type also needs. Make a checklist from the hits, and tick each one as you go. Also add the new type to `SUPPORTED_MACHINE_TYPES` (`packages/shared/src/requests.ts`) and run `npm run build:shared`: `npm run typecheck` then shows each `switch` that misses the new type.

## 3. Build it, test first

Write the test before the code in each step (see CONTRIBUTING.md). The parts, in order:

1. **Connector:** `apps/server/src/machines/<type>/`. Extend `BaseMachineConnector`. `getDataSnapshot()` maps the control's values to `MachineDataSnapshot`. History, reports and alerts read only that snapshot, so a value that is in the snapshot works there with no more code. Leave a value `undefined` when the control does not send it. Put the parsing in small pure functions with their own tests (as `sinumerikValues.ts`), and add the connector to `apps/server/src/machines/connector.schema.test.ts`.
2. **Types and requests:** `apps/server/src/types/index.ts`, `packages/shared/src/machines.ts`, `packages/shared/src/requests.ts`, `apps/server/src/routes/schemas.ts`.
3. **Storage:** a new `<type>_machines` table in `apps/server/src/storage/schema.ts` (`CREATE TABLE IF NOT EXISTS`, so old databases get it on start), and its load and save in `apps/server/src/polling/machineRepository.ts`.
4. **Polling:** `apps/server/src/polling/poller.ts`, `machineSettings.ts` and `machinePorts.ts`. Put the default port in `packages/shared/src/ports.ts` (as `DEFAULT_OPCUA_PORT`), so the server and the web app use the same number.
5. **Network scan:** `apps/server/src/discovery/askMachines.ts` and `NetworkScanner.ts`. Ask the control a harmless question that only this type answers.
6. **Web app:** the type name and the alarm help (`apps/web/src/machines/`), the add form and the scan text (`apps/web/src/pages/dashboard/`), and the settings form and the job values (`apps/web/src/pages/machine-detail/`).
7. **Fake machine:** a fake control in `tools/fake-machines/` that answers in the same protocol, and its row in `docs/develop/fake-machines.md`. `siemens` has none, so copy `tools/fake-machines/haas.ts` or `brother.ts`. Skip this only when the protocol needs a closed library.
8. **Docs:** a guide page `docs/guide/<type>.md` (set up the control, add the machine, what Chatter reads, a **Check** table of error messages), its line in `docs/.vitepress/config.mts`, the type in `docs/api/machines.md`, `docs/api/history.md` (spindle load and run state), `docs/security.md`, `docs/index.md` and `README.md`. Write in ASD-STE100 Simplified Technical English.

## Rules for a connector

- **Passwords:** a password for the control is kept in `chatter.db` and never goes back to the browser. The status gives only `has<Name>Password`, as `hasFtpPassword` and `hasOpcuaPassword` do. An update with no password keeps the saved one.
- **Errors:** put the reason in `errors`. The log writes it when the machine goes offline (`docs/guide/logs.md`), so make it say what the user must check.
- **Pi:** a Pi can have 512 MB of RAM. Keep one connection for each machine, and read only the values that the snapshot uses.
- **Real machines:** when nobody has tested the type on a real control, the docs say "not tested on real machines yet", as `docs/api/history.md` does.

## Done

- Each hit from step 2 has its counterpart for the new type, and so do the three things that the template skipped.
- `npm run build:shared`, `npm run typecheck`, `npm test` and `npm run docs:build` pass.
- With `npm run dev` and `npm run fake-machines -- --add`, the fake machine of the new type shows its values on the **Machines** page.
