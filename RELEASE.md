# 发版清单 / Release checklist

## 每次发版 / Every release

1. `npm test` must pass locally (CI runs the same, on Node 20 and 24).
2. **手动跑一遍真实 magpie / Run `./e2e.sh` against a real magpie and a real key** before tagging:
   ```sh
   SYSTALYZE_KEY=stlzi_... ./e2e.sh
   ```
   Check that:
   - `plugin add` reports `systalyze (Systalyze, 10 models)`;
   - `plugin login systalyze` accepts the key without asking again afterwards;
   - `quota systalyze --json` shows the three windows (`今日` / `近 7 天` / `近 30 天`), each with
     `unit: "tokens"` and an `aside` flag, plus one window per model when `perModel` is on;
   - `models` lists all 10 models under `systalyze/`, with context and output limits;
   - `provider test systalyze` gets an answer (a real chat request).
3. Bump `version` in `package.json` and commit.
4. Tag it and push the tag: `git tag v0.1.0 && git push origin v0.1.0`. The tag must be `v` + the package's version.
5. `publish.yml` runs the tests and then `npm publish --provenance --access public` over OIDC. Check the package page on npm for the provenance badge.

## 第一次发布（启用 trusted publishing）/ First publish

npm configures trusted publishing per package, in the package's settings, so the package has to exist first.

1. Create the GitHub repo `zwnes/magpie-systalyze` and push `main`. `package.json`'s `repository.url` must match this repo exactly (`git+https://github.com/zwnes/magpie-systalyze.git`).
2. Publish 0.1.0 by hand from a clean checkout of the tag:
   ```sh
   npm login
   npm publish --access public
   ```
   Don't push the `v0.1.0` tag before this: `publish.yml` would fail, because the package doesn't exist yet. If you push it afterwards, that run's publish step fails because 0.1.0 is already on npm, and that failure is expected.
3. On npmjs.com, go to **magpie-systalyze › Settings › Trusted publishing** and add **GitHub Actions** with:
   - organization or user: `zwnes`
   - repository: `magpie-systalyze`
   - workflow filename: `publish.yml`
   - environment: leave it empty (the workflow uses none)
4. Use the new config within 2 days, or it lapses: bump to the next version and release with a tag as above, so the first OIDC publish happens.
5. Once it works, in the same Settings page set **Publishing access** to require 2FA and disallow tokens. Then only the workflow can publish. Revoke any automation token you made.

Requirements the workflow already meets:
- `permissions: id-token: write`
- Node ≥ 22.14 (the workflow uses 24)
- npm ≥ 11.5.1 (installed in the job)
- a GitHub-hosted runner

With trusted publishing npm adds provenance on its own; `--provenance` is kept so the intent is explicit.
