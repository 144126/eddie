# Assets

Required for Firecracker microVMs.

## vmlinux (Linux kernel)

Download from Firecracker releases:

```bash
FC_VERSION="1.10.1"
curl -Lo assets/vmlinux \
  "https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v${FC_VERSION}/x86_64/vmlinux-5.10.225"
```

## rootfs.ext4 (VM root filesystem)

Built by `scripts/build-rootfs.sh`:

```bash
pnpm run build:rootfs
```
