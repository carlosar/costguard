## [0.5.1](https://github.com/carlosar/costguard/compare/v0.5.0...v0.5.1) (2026-06-24)


### Bug Fixes

* **ci:** correct repo-root paths in PR gate workflow ([1820afb](https://github.com/carlosar/costguard/commit/1820afb28ca19a8f2ffcf4f4a011f33addeead7d))

# [0.5.0](https://github.com/carlosar/costguard/compare/v0.4.3...v0.5.0) (2026-06-24)


### Features

* add copy-fix-prompt quick action and refresh README marketplace listing ([af2e22c](https://github.com/carlosar/costguard/commit/af2e22cd0d340e0a441131ad152f3d033da2117a))

## [0.4.3](https://github.com/carlosar/costguard/compare/v0.4.2...v0.4.3) (2026-06-19)


### Bug Fixes

* **fcg001:** detect state setter called inside its own dependent useEffect ([7d2a4d9](https://github.com/carlosar/costguard/commit/7d2a4d9b81b887ebe654ef989a377abf24e08945))

## [0.4.2](https://github.com/carlosar/costguard/compare/v0.4.1...v0.4.2) (2026-06-17)


### Bug Fixes

* suppress setup banner when no workspace folder is open ([b6c4f17](https://github.com/carlosar/costguard/commit/b6c4f17b7da38cc91296391a7a70440e71b42295))

## [0.4.1](https://github.com/carlosar/costguard/compare/v0.4.0...v0.4.1) (2026-06-15)


### Bug Fixes

* use shell var syntax for VSCE_PAT in publishCmd ([2dc8579](https://github.com/carlosar/costguard/commit/2dc857962e8ab4c27c471c7e3d96031be9e56116))

# [0.4.0](https://github.com/carlosar/costguard/compare/v0.3.1...v0.4.0) (2026-06-15)


### Bug Fixes

* remove circular costguard self-dep and hardcoded predeploy path ([a8727dc](https://github.com/carlosar/costguard/commit/a8727dcedcfda77b128b72836aae2e6a3286067c))


### Features

* add opt-in telemetry via @vscode/extension-telemetry ([8eea11c](https://github.com/carlosar/costguard/commit/8eea11c87466666e52e876d90a5c1646578876af))

## [0.3.1](https://github.com/carlosar/costguard/compare/v0.3.0...v0.3.1) (2026-06-13)


### Bug Fixes

* correct diagnostic underline length for inline httpsCallable invocations in FCG017 ([ea726c5](https://github.com/carlosar/costguard/commit/ea726c5b785c1cdb77182a131e71d9ba5bbfaecf))
* eliminate FCG009 false positives on helpers called from event handlers ([3d402cd](https://github.com/carlosar/costguard/commit/3d402cd6fff84128ad0023c9970caaa93a562aed))
