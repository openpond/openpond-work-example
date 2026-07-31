# Local SDK artifact

`openpond-sdk-0.0.1.tgz` is generated from the sibling OpenPond checkout with `pnpm build:sdk && npm pack ./packages/sdk --pack-destination ../openpond-work-example/vendor`. It exercises the same package artifact that is published to npm and can be removed after the app switches to the public package.
