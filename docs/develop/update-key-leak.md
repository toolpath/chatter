# If the update key leaks

Do these steps when the private key that signs the update files is no longer secret. For example, a person saw the secret `UPDATE_SIGNING_KEY`, or a workflow printed it.

## What the leaked key can do

The update helper on the Pi card installs, as root, each update file that has a correct signature and a newer version. So a person with the key can make an update file that each Pi card accepts, and get full control of that Pi.

The person must still bring the file to the Pi. For example, an Admin uploads it in **Settings > Updates**, the file is on a GitHub release of Chatter, or the person already controls Chatter on that Pi.

## Why a card stays at risk

- The helper trusts each public key in `/etc/chatter/update-keys/` on the card.
- The card image puts these keys on the card. `customize.sh` copies each `.pub` file of `tools/pi-image/in-pi/update-keys/`.
- An update file never changes the helper or its keys.

So a card trusts the leaked key until the user puts a new card image on it. Chatter has no code to revoke a key on a card.

## Steps

1. **Stop the old key on GitHub.** In the repo, go to **Settings > Environments > release**. Delete the secret `UPDATE_SIGNING_KEY`. Then the sign job cannot sign with the old key. Until step 5, the sign job of each release tag fails.
2. **Look for bad files.** On the **Releases** page, look at each `chatter-update-*.tar` file and each `v*` tag. Delete each file or release that you did not make.
3. **Make a new key.** Do this on a computer that you trust. Give the key a new name, for example `chatter-2027`. The name can have only lowercase letters, digits and `-`, with at most 64 characters. From the repo root, run:
   ```bash
   openssl genpkey -algorithm ed25519 -out chatter-2027.pem
   openssl pkey -in chatter-2027.pem -pubout -out tools/pi-image/in-pi/update-keys/chatter-2027.pub
   ```
   Do not commit `chatter-2027.pem`. It is the private key.
4. **Remove the old public key from the repo.** Delete `tools/pi-image/in-pi/update-keys/chatter-2026.pub`, so that a new card does not trust the leaked key. In [Pi card image](./pi-image.md), change the name of the release key. Merge this change into `main` in a pull request.
5. **Give the new key to the sign job.** Put the private key in the `release` environment, and set the key name:
   ```bash
   gh secret set UPDATE_SIGNING_KEY --env release < chatter-2027.pem
   gh variable set UPDATE_KEY_ID --env release --body chatter-2027
   ```
   Without `UPDATE_KEY_ID`, the sign job uses the name `chatter-2026`. Then delete `chatter-2027.pem` from the computer, or keep it only on an offline disk.
6. **Make a new release.** Tag a commit of `main` that has the change of step 4. The sign job checks the signature with the public key of the tagged commit. So a wrong secret or a wrong key name stops the job. The release then has an update file that is signed with the new key, and a card image that has only the new public key.
7. **Tell the users.** Write a security advisory on GitHub, and put the same text in the notes of the new release. Tell the users these facts:
   - Each Pi card from an older card image trusts the leaked key.
   - That card refuses each update file that is signed with the new key. **Settings > Updates** shows "The update file is signed with a key that this Pi does not know."
   - To fix both, put the new card image on the card. To keep the data, first [back up the Pi card by hand](../guide/update.md#back-up-the-pi-card-by-hand), and copy the two backup files off the Pi. These commands need SSH on the Pi. After the new card image starts, copy the two files into `/opt/chatter` on the Pi, and [restore the backup](../guide/update.md#restore-a-backup) there, with `sudo` before each `docker`.
   - Until then, do not upload an update file that you did not download from the Chatter releases.
8. **Warn about the old card images.** Each card image of an older release has the leaked key. In the notes of each older release, tell the users to use the card image of the new release.

A computer with Docker has no update helper and no update key. These steps do not apply to it.
