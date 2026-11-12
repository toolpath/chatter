# Contributing to Chatter

Thank you for your help. Bug reports, fixes, and docs changes are welcome.

## Report a problem

- **A bug:** open an issue. Tell us the Chatter version, how you run Chatter (the Pi card or Docker), the machine type, and the steps to make it happen.
- **A security problem:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Make a change

1. Read [Run from source](https://toolpath.github.io/chatter/develop/) to set up Chatter on your computer. The [fake machines](https://toolpath.github.io/chatter/develop/fake-machines) let you test without a real CNC machine.
2. Make a branch from `main`.
3. Write a test for the change first. Then make the change.
4. Make sure that these commands pass:
   ```bash
   npm run build:shared
   npm run typecheck
   npm test
   ```
   For a docs change, also run `npm run docs:build`.
5. Open a pull request. Say what the change does, and how you tested it. Tell us if you tested on a real machine, and which one.

Keep one kind of change in each commit, for example a fix, a feature, or a docs change.

## Do not add FANUC files

The FANUC FOCAS2 library belongs to FANUC. Never add its files (for example `Fwlib*.dll` or `libfwlib32*.so`) to the repo or to the Docker image. Each user uploads the library in **Settings > FANUC library**.

## License

Chatter uses the MIT license. When you send a change, you agree that it uses the same license. See [LICENSE](LICENSE).
