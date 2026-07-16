# OCI Deploy via NixOS Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Notion task burndown chart off the Raspberry Pi onto an Oracle Cloud Always Free ARM VM (`us-ashburn-1`, hostname `notion-task-burndown-chart`), and refactor the surrounding repos into composable NixOS flake modules along the way.

**Architecture:** Four-repo composition — `nixos-ocp-tailscale-vm-iac` becomes a pure library exporting `nixosModules.base` + a Terraform module; `tailscale-exit-node-nixos-module` (new) and `changedetection.io-tailscale-nixos-module` (renamed) are pure NixOS module flakes; the burndown repo gains a `nix/` directory exporting its hermetic build derivation + service module, and a new `deploy/` directory that wires everything together for the OCI VM.

**Tech Stack:** Deno + SvelteKit (app, unchanged), Nix 25.11 (`buildDenoPackage`-equivalent via FOD), NixOS 25.11 on aarch64-linux, Terraform (OCI provider), Tailscale (auth via OAuth → `tag:oauth-generated`), 1Password CLI (secret retrieval).

**Repo paths used throughout:**

- IaC: `/Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac` (local dir) ↔ `github:alexjmiller5/nixos-ocp-tailscale-vm-iac` (remote)
- Burndown: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart` ↔ `github:alexjmiller5/notion-task-burndown-chart`
- Changedetection: `/Users/alexmiller/Desktop/coding/active-projects/change-detection-deployment` ↔ `github:alexjmiller5/change-detection-deployment` (both to be renamed)
- Exit-node: NEW, will be created at `/Users/alexmiller/Desktop/coding/active-projects/tailscale-exit-node-nixos-module` ↔ `github:alexjmiller5/tailscale-exit-node-nixos-module`

**Phase order:**

1. IaC library refactor (foundation for everything downstream)
2. Burndown source-level cache-path env var (small, test-driven, unblocks Nix module)
3. Burndown `nix/` — hermetic build derivation + service module
4. Burndown `deploy/` — Terraform + wire-it flake + justfile
5. OCI bootstrap + verify (real infra; the user-visible win)
6. Pi decommission
7. Exit-node module extraction (cleanup, after main goal achieved)
8. Changedetection refactor (cleanup, after main goal achieved)

The spec says committing is gated by user ask. **Every task that ends in a commit step requires explicit user approval — surface the proposed commit message and wait.**

---

## Phase 1: IaC library refactor

### Task 1.1: Add `modules/base.nix` to the IaC repo

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/modules/base.nix`

- [ ] **Step 1: Create the module directory and file**

Run:

```bash
mkdir -p /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/modules
```

- [ ] **Step 2: Write `modules/base.nix`**

Write exactly this content:

```nix
{ config, lib, pkgs, ... }:
let
  secrets = if builtins.pathExists /etc/nixos/secrets.nix
            then import /etc/nixos/secrets.nix
            else { tailscaleAuthKey = null; };
in {
  networking.useDHCP = true;

  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ 22 ];
    allowedUDPPorts = [ config.services.tailscale.port ];
    trustedInterfaces = [ "tailscale0" ];
    checkReversePath = "loose";
  };

  services.tailscale = {
    enable = true;
    useRoutingFeatures = "server";
    authKeyFile = lib.mkIf (secrets.tailscaleAuthKey != null) "/etc/tailscale/authkey";
  };

  environment.etc."tailscale/authkey" = lib.mkIf (secrets.tailscaleAuthKey != null) {
    text = secrets.tailscaleAuthKey;
    mode = "0400";
  };

  services.openssh = {
    enable = true;
    settings = {
      PermitRootLogin = "prohibit-password";
      PasswordAuthentication = false;
    };
  };

  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO7ZCS39YKZ+E/U0aFXe6qfBTfPOgT6NWN7LoOddv7/0"
  ];

  environment.systemPackages = with pkgs; [
    vim
    wget
    curl
    htop
    jq
  ];

  time.timeZone = lib.mkDefault "UTC";

  system.autoUpgrade = {
    enable = true;
    allowReboot = false;
  };

  system.stateVersion = "25.11";
}
```

Note `secrets` path is now `/etc/nixos/secrets.nix` (absolute) because this module is imported from outside the IaC repo; consumers ship their `secrets.nix` to that path via `install-infect`. `time.timeZone` uses `lib.mkDefault` so deploy stacks can override.

### Task 1.2: Add `terraform/oci-vm/` module to the IaC repo

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/terraform/oci-vm/main.tf`
- Create: `/Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/terraform/oci-vm/variables.tf`
- Create: `/Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/terraform/oci-vm/outputs.tf`
- Create: `/Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/terraform/oci-vm/versions.tf`

- [ ] **Step 1: Create the directory**

Run:

```bash
mkdir -p /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/terraform/oci-vm
```

- [ ] **Step 2: Write `versions.tf`**

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
  }
}
```

- [ ] **Step 3: Write `variables.tf`**

```hcl
variable "compartment_id" {
  type        = string
  description = "OCI compartment OCID."
}

variable "region" {
  type        = string
  description = "OCI region."
  default     = "us-ashburn-1"
}

variable "vcn_cidr" {
  type        = string
  description = "CIDR for the VCN. Each VM stack should pick a distinct block."
  default     = "10.0.0.0/16"
}

variable "subnet_cidr" {
  type        = string
  description = "CIDR for the subnet — must be inside vcn_cidr."
  default     = "10.0.0.0/24"
}

variable "shape" {
  type        = string
  description = "Compute shape."
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  type        = number
  description = "OCPUs (Always Free total cap: 4)."
  default     = 1
}

variable "memory_gb" {
  type        = number
  description = "Memory in GB (Always Free total cap: 24)."
  default     = 6
}

variable "boot_volume_size_gb" {
  type        = number
  description = "Boot volume in GB (Always Free total cap: 200)."
  default     = 50
}

variable "display_name" {
  type        = string
  description = "Human-readable instance name (also seen in OCI console)."
}

variable "ssh_public_key" {
  type        = string
  description = "Public SSH key authorized on the instance."
}
```

- [ ] **Step 4: Write `main.tf`**

```hcl
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_id
}

data "oci_core_images" "ubuntu_images" {
  compartment_id           = var.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_id
  cidr_block     = var.vcn_cidr
  display_name   = "${var.display_name}-vcn"
}

resource "oci_core_internet_gateway" "igw" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.this.id
  enabled        = true
  display_name   = "${var.display_name}-igw"
}

resource "oci_core_default_route_table" "default_route" {
  manage_default_resource_id = oci_core_vcn.this.default_route_table_id

  route_rules {
    network_entity_id = oci_core_internet_gateway.igw.id
    destination       = "0.0.0.0/0"
  }
}

resource "oci_core_subnet" "this" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.this.id
  cidr_block     = var.subnet_cidr
  route_table_id = oci_core_vcn.this.default_route_table_id
  display_name   = "${var.display_name}-subnet"
}

resource "oci_core_instance" "this" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_id
  display_name        = var.display_name
  shape               = var.shape

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.this.id
    assign_public_ip = true
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_images.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_size_gb
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }
}
```

- [ ] **Step 5: Write `outputs.tf`**

```hcl
output "instance_public_ip" {
  value       = oci_core_instance.this.public_ip
  description = "Public IPv4 of the OCI instance."
}

output "instance_ocid" {
  value       = oci_core_instance.this.id
  description = "OCID of the OCI instance."
}
```

- [ ] **Step 6: Validate the module**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/terraform/oci-vm && terraform init -backend=false && terraform validate
```

Expected: `Success! The configuration is valid.`

### Task 1.3: Update IaC `flake.nix` to library shape

**Files:**

- Modify: `/Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac/flake.nix`

- [ ] **Step 1: Replace `flake.nix` entirely**

```nix
{
  description = "OCI NixOS VM base — reusable NixOS module + Terraform module";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs = { self, nixpkgs }: {
    nixosModules.base = import ./modules/base.nix;
    # Terraform module is consumed via git:: source pointing at terraform/oci-vm/,
    # not via flake outputs.
  };
}
```

- [ ] **Step 2: Validate the flake**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac && nix flake check --no-build
```

Expected: no errors. (`--no-build` skips evaluating `legacyPackages` etc. and just type-checks outputs.)

### Task 1.4: Delete now-stale top-level files from IaC repo

The IaC repo's `configuration.nix`, `main.tf`, `variables.tf`, `outputs.tf`, `terraform.tf`, `hardware-configuration.nix`, `justfile`, `terraform.tfstate*`, `.terraform/`, and `.terraform.lock.hcl` are leftovers from when it was an exit-node deploy stack. They're now stale.

**Files:**

- Delete: many (see step 1)

- [ ] **Step 1: List what we're about to remove for visual confirmation**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac && ls -la configuration.nix main.tf variables.tf outputs.tf terraform.tf hardware-configuration.nix justfile terraform.tfstate terraform.tfstate.backup .terraform.lock.hcl 2>/dev/null; ls -d .terraform 2>/dev/null
```

Expected: lists files. If you see anything unexpected, STOP and ask the user.

- [ ] **Step 2: Stage deletions (don't commit yet)**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac && git rm -f configuration.nix main.tf variables.tf outputs.tf terraform.tf hardware-configuration.nix justfile terraform.tfstate terraform.tfstate.backup .terraform.lock.hcl && rm -rf .terraform
```

Expected: `rm` output for each file.

- [ ] **Step 3: Update `.gitignore` if needed**

Read `.gitignore` and confirm it still makes sense. Should still ignore `.terraform/`, `*.tfvars`, `secrets.nix`. No change needed unless something is off.

- [ ] **Step 4: Update the repo's `CLAUDE.md`**

The CLAUDE.md describes a deploy stack that no longer exists. Replace it with a library description.

Read the existing CLAUDE.md, then rewrite to a "library" framing:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reusable building blocks for deploying NixOS to Oracle Cloud Infrastructure (OCI) Always Free ARM VMs. This repo is a **library**, not a deploy stack — it does not provision any VM by itself.

**Two outputs:**

1. **Nix flake** — exports `nixosModules.base`: SSH (root key-only), Tailscale daemon, firewall basics, auto-upgrades, sensible defaults. Consumers add their own service modules on top.
2. **Terraform module** at `terraform/oci-vm/` — provisions one OCI Always Free ARM instance with its own VCN/subnet/IGW. Consumers reference via `module "vm" { source = "git::https://github.com/alexjmiller5/nixos-ocp-tailscale-vm-iac.git//terraform/oci-vm?ref=main" }`.

Deployment flow (executed by consuming repos, not here): `terraform apply` provisions Ubuntu 22.04 ARM → `nixos-infect` converts in-place to NixOS 25.11 → consumer's flake.nix wires `base` + service module(s) + hardware-configuration → `nixos-rebuild switch`.

## Architecture

### `modules/base.nix`

Imported by every consumer's deploy flake. Declares:

- `services.openssh` (root key-only, no password)
- `services.tailscale` (server routing features, optional authKeyFile sourced from `/etc/nixos/secrets.nix` if present)
- `networking.firewall` (TCP 22 + tailscale UDP, `tailscale0` trusted, reverse-path loose)
- `networking.useDHCP = true`
- `system.autoUpgrade.enable = true; allowReboot = false`
- `system.stateVersion = "25.11"` (locked — never change)
- Root SSH key authorized
- `time.timeZone` defaults to `UTC` via `lib.mkDefault` — consumers override

The module does **not** set `networking.hostName` — each consumer's deploy flake provides it.

### `terraform/oci-vm/`

Standalone Terraform module that creates VCN + subnet + IGW + instance. Variables:

- `compartment_id` (required), `region` (default `us-ashburn-1`)
- `vcn_cidr`, `subnet_cidr` — picked per consumer to avoid overlap
- `shape`, `ocpus`, `memory_gb`, `boot_volume_size_gb` — defaults match Always Free ARM
- `display_name`, `ssh_public_key`

Outputs: `instance_public_ip`, `instance_ocid`.

## Consumers

- `notion-task-burndown-chart` — burndown chart service VM (1 OCPU / 6 GB / 50 GB)
- `change-detection-deployment` (to be renamed `changedetection.io-tailscale-nixos-module`) — changedetection.io VM (2 OCPU / 12 GB / 50 GB)
- `tailscale-exit-node-nixos-module` — module repo only (no deploy stack); composed into other deploys when an exit-node is wanted

## Key Constraints

- `system.stateVersion` in `modules/base.nix` must remain `25.11`. Never change once an installed VM exists with that value.
- Root SSH ed25519 key is hardcoded — change it here and re-deploy every VM if it ever rotates.
- Always Free tier shares 4 OCPU / 24 GB RAM / 200 GB boot across all instances in the tenancy. Sum across consumers.
```

Write this as the new `CLAUDE.md`.

- [ ] **Step 5: Update README.md**

Read the current README (it's 15 chars per the earlier `ls`). Replace with a one-paragraph description:

```markdown
# nixos-ocp-tailscale-vm-iac

Reusable NixOS module + Terraform module for deploying NixOS to Oracle Cloud Always Free ARM VMs. Library only — see consumer repos for actual VM deploys.
```

- [ ] **Step 6: Run `nix flake check` to confirm the refactored repo is well-formed**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac && nix flake check --no-build
```

Expected: no errors.

- [ ] **Step 7: Surface commit message to user for approval**

Propose this commit message to the user and wait for explicit approval before running `git commit`:

```
refactor: convert to library — extract base module + Terraform module

Splits the repo into:
- `modules/base.nix` — reusable NixOS module (SSH, tailscale, firewall basics)
- `terraform/oci-vm/` — reusable Terraform module for VCN + subnet + instance

Removes stale top-level deploy-stack files (configuration.nix, main.tf,
hardware-configuration.nix, justfile, terraform state) that targeted a
now-destroyed exit-node VM. Consumers will live in their own repos and
import these modules.
```

When user approves, run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac && git add -A && git commit -m "refactor: convert to library — extract base module + Terraform module" -m "Splits the repo into:" -m "- modules/base.nix — reusable NixOS module (SSH, tailscale, firewall basics)" -m "- terraform/oci-vm/ — reusable Terraform module for VCN + subnet + instance" -m "Removes stale top-level deploy-stack files (configuration.nix, main.tf, hardware-configuration.nix, justfile, terraform state) that targeted a now-destroyed exit-node VM. Consumers will live in their own repos and import these modules."
```

- [ ] **Step 8: Push to GitHub**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/nixos-ocp-tailscale-vm-iac && git push origin main
```

Expected: push succeeds. We need this on GitHub so downstream flakes can reference `github:alexjmiller5/nixos-ocp-tailscale-vm-iac`.

---

## Phase 2: Burndown — `cache.ts` env-var path (test-driven)

### Task 2.1: Add a failing test for `BURNDOWN_CACHE_PATH`

**Files:**

- Test: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/src/lib/server/cache.test.ts` (new)

- [ ] **Step 1: Read the current `cache.ts` to confirm the API**

Run:

```bash
cat /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/src/lib/server/cache.ts
```

Note the exported functions (likely `readCache`, `writeCache`) and the current literal path. The test will mock or set env to exercise the path-resolution logic.

- [ ] **Step 2: Write a focused unit test for the path resolution**

If `cache.ts` doesn't yet have a `getCachePath()` or similar export, the cleanest TDD design is to introduce one. Plan the test as:

```ts
// src/lib/server/cache.test.ts
import { assertEquals } from '@std/assert';
import { getCachePath } from './cache.ts';

Deno.test('getCachePath defaults to ./notion-cache.json when env unset', () => {
	Deno.env.delete('BURNDOWN_CACHE_PATH');
	assertEquals(getCachePath(), './notion-cache.json');
});

Deno.test('getCachePath honors BURNDOWN_CACHE_PATH env var', () => {
	Deno.env.set('BURNDOWN_CACHE_PATH', '/var/lib/burndown/notion-cache.json');
	try {
		assertEquals(getCachePath(), '/var/lib/burndown/notion-cache.json');
	} finally {
		Deno.env.delete('BURNDOWN_CACHE_PATH');
	}
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && deno test -A --unstable-sloppy-imports src/lib/server/cache.test.ts
```

Expected: FAIL — `getCachePath` is not exported from `cache.ts`.

### Task 2.2: Implement `getCachePath` and route reads/writes through it

**Files:**

- Modify: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/src/lib/server/cache.ts`

- [ ] **Step 1: Add `getCachePath` export and route existing functions through it**

Read the current `cache.ts`, find every reference to the literal cache path (likely `"notion-cache.json"` or `"./notion-cache.json"`), and replace with a single helper:

At the top of `cache.ts`, add (or restructure existing):

```ts
export function getCachePath(): string {
	return Deno.env.get('BURNDOWN_CACHE_PATH') ?? './notion-cache.json';
}
```

Then ensure every `Deno.readTextFile` / `Deno.writeTextFile` inside `readCache` / `writeCache` (or whatever the existing function names are) uses `getCachePath()` instead of a literal.

Do not change function signatures or external API beyond adding `getCachePath`.

- [ ] **Step 2: Run the new test — should pass**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && deno test -A --unstable-sloppy-imports src/lib/server/cache.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 3: Run the full test suite to ensure no regressions**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && deno task test
```

Expected: all tests pass, including any prior tests touching `cache.ts`.

- [ ] **Step 4: Propose commit to user**

Propose:

```
feat(cache): honor BURNDOWN_CACHE_PATH env var

Adds `getCachePath()` that reads `BURNDOWN_CACHE_PATH`, falling back to
`./notion-cache.json` for the existing Pi/dev flow. The OCI systemd
unit sets this env to `/var/lib/burndown/notion-cache.json` so the
cache lives in a writable StateDirectory, not next to the read-only
Nix store path.
```

On approval:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && git add src/lib/server/cache.ts src/lib/server/cache.test.ts && git commit -m "feat(cache): honor BURNDOWN_CACHE_PATH env var" -m "Adds getCachePath() that reads BURNDOWN_CACHE_PATH, falling back to ./notion-cache.json for the existing Pi/dev flow. The OCI systemd unit sets this env to /var/lib/burndown/notion-cache.json so the cache lives in a writable StateDirectory, not next to the read-only Nix store path."
```

(Don't push yet — Phases 3 & 4 will add to this branch.)

---

## Phase 3: Burndown `nix/` — hermetic build + service module

### Task 3.1: Scaffold `nix/` directory and `package.nix`

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix/package.nix`

- [ ] **Step 1: Create the directory**

Run:

```bash
mkdir -p /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix
```

- [ ] **Step 2: Write `nix/package.nix`**

```nix
{ pkgs, lib }:
let
  src = ../.;

  denoCache = pkgs.stdenv.mkDerivation {
    pname = "burndown-deno-cache";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [ pkgs.deno ];

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = lib.fakeHash;

    buildPhase = ''
      runHook preBuild
      export DENO_DIR=$out/.deno
      export HOME=$TMPDIR
      mkdir -p $out
      cd $TMPDIR
      cp -r $src/. .
      deno install --allow-scripts --frozen
      cp -r node_modules $out/node_modules
      runHook postBuild
    '';

    installPhase = "true";
    dontStrip = true;
    dontFixup = true;
  };
in
pkgs.stdenv.mkDerivation {
  pname = "notion-task-burndown-chart";
  version = (lib.importJSON ../package.json).version or "0.1.0";
  inherit src;
  nativeBuildInputs = [ pkgs.deno ];

  buildPhase = ''
    runHook preBuild
    export DENO_DIR=${denoCache}/.deno
    cp -r ${denoCache}/node_modules ./node_modules
    chmod -R +w node_modules
    deno run --cached-only -A npm:vite build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r build $out/build
    cp -r node_modules $out/node_modules
    cp package.json deno.json deno.lock $out/
    runHook postInstall
  '';
}
```

### Task 3.2: Write `nix/module.nix`

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix/module.nix`

- [ ] **Step 1: Write `module.nix`**

```nix
{ self }:
{ config, lib, pkgs, ... }:
let cfg = config.services.burndown; in {
  options.services.burndown = {
    enable = lib.mkEnableOption "Notion task burndown chart";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.system}.default;
      description = "Hermetic burndown build (defaults to this flake's packages.default).";
    };
    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Loopback port the SvelteKit server binds to.";
    };
    origin = lib.mkOption {
      type = lib.types.str;
      description = "Public ORIGIN URL (must match what users hit in the browser).";
    };
    envFile = lib.mkOption {
      type = lib.types.path;
      default = "/etc/burndown.env";
      description = "Path to environment file containing NOTION_API_KEY (mode 0600).";
    };
    tailscaleServe = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether to expose the service via `tailscale serve`.";
    };
    serveHttpsPort = lib.mkOption {
      type = lib.types.port;
      default = 443;
      description = "HTTPS port to expose via tailscale serve.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.burndown = {
      description = "Notion task burndown chart";
      after = [ "network.target" "tailscaled.service" ];
      wants = [ "tailscaled.service" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "simple";
        WorkingDirectory = cfg.package;
        StateDirectory = "burndown";
        Environment = [
          "PORT=${toString cfg.port}"
          "HOST=127.0.0.1"
          "ORIGIN=${cfg.origin}"
          "BURNDOWN_CACHE_PATH=/var/lib/burndown/notion-cache.json"
        ];
        EnvironmentFile = cfg.envFile;
        ExecStart = "${pkgs.deno}/bin/deno run -A build/index.js";
        Restart = "on-failure";
        RestartSec = 5;
        DynamicUser = true;
      };
    };

    systemd.services.burndown-tailscale-serve = lib.mkIf cfg.tailscaleServe {
      description = "Configure tailscale serve for burndown";
      after = [ "tailscaled.service" "burndown.service" ];
      wants = [ "tailscaled.service" ];
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.tailscale pkgs.jq ];
      script = ''
        while ! tailscale status --json 2>/dev/null | jq -e '.Self.Online' > /dev/null 2>&1; do
          sleep 5
        done
        tailscale serve --bg --yes --https=${toString cfg.serveHttpsPort} \
          http://localhost:${toString cfg.port}
      '';
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
      };
    };
  };
}
```

### Task 3.3: Write `nix/flake.nix`

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix/flake.nix`

- [ ] **Step 1: Write `flake.nix`**

```nix
{
  description = "Notion task burndown chart — service module + hermetic build";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-linux" "x86_64-linux" "aarch64-darwin" "x86_64-darwin" ];
      forAll = nixpkgs.lib.genAttrs systems;
    in {
      packages = forAll (sys: {
        default = nixpkgs.legacyPackages.${sys}.callPackage ./package.nix { };
      });
      nixosModules.default = import ./module.nix { inherit self; };
    };
}
```

- [ ] **Step 2: `nix flake check` on the flake (no build yet — we still need the FOD hash)**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix && nix flake check --no-build
```

Expected: no evaluation errors. If you see errors here, fix before continuing.

### Task 3.4: First build to surface the FOD hash, then commit the real hash

**Files:**

- Modify: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix/package.nix`

- [ ] **Step 1: Pick the correct system for local build**

On Alex's Mac:

```bash
uname -m
```

If `arm64`: target `aarch64-darwin`. If `x86_64`: target `x86_64-darwin`. Below uses `aarch64-darwin` — substitute if needed.

- [ ] **Step 2: Try a build — it will fail with the real hash**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix && nix build .#packages.aarch64-darwin.default
```

Expected: Nix reports a hash-mismatch error of the form:

```
error: hash mismatch in fixed-output derivation '...burndown-deno-cache.drv':
         specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
            got:    sha256-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX=
```

Copy the `got:` value.

- [ ] **Step 3: Paste the real hash into `package.nix`**

Edit `nix/package.nix`, replacing `outputHash = lib.fakeHash;` with `outputHash = "sha256-<the-got-value>";` (keep the quotes; include the `sha256-` prefix).

- [ ] **Step 4: Rebuild — should now succeed**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix && nix build .#packages.aarch64-darwin.default
```

Expected: build succeeds. Result symlinked at `./result`.

- [ ] **Step 5: Smoke-test the built artifact**

Run (in a separate terminal or backgrounded):

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/nix && \
  BURNDOWN_CACHE_PATH=/tmp/burndown-test-cache.json \
  NOTION_API_KEY="$(op item get 'Notion Task Burndown Chart Notion Internal Integration Secret' --fields credential --reveal)" \
  PORT=3001 HOST=127.0.0.1 ORIGIN="http://localhost:3001" \
  deno run -A result/build/index.js &
SVR_PID=$!
sleep 8
curl -sS -o /tmp/burndown-smoke.html -w "%{http_code}\n" http://localhost:3001/
kill $SVR_PID 2>/dev/null
```

Expected: HTTP 200, `/tmp/burndown-smoke.html` contains SvelteKit markup (look for `<html` and chart-related content).

If the smoke test fails, STOP and investigate. Common issues:

- `node_modules` path not resolving → ensure `WorkingDirectory` points at the package output and `node_modules` was copied (it is, per `installPhase`)
- Deno permission errors → already addressed via `-A`

- [ ] **Step 6: Add `nix/` to `CLAUDE.md` (project-local)**

Read the burndown repo's `CLAUDE.md`, find the "Deployment" section, and add a note about `nix/` above it (we'll fully rewrite Deployment in Phase 6):

After the existing module-listing sections and before the Deployment section, add:

```markdown
## Nix module + hermetic build (`nix/`)

`nix/flake.nix` exports two outputs:

- `packages.<system>.default` — hermetic SvelteKit build via a two-derivation pattern (fixed-output dep cache pinned to `deno.lock`, then a sandboxed build using `--cached-only`). Built artifact contains `build/`, `node_modules/`, and copies of `package.json`/`deno.json`/`deno.lock`.
- `nixosModules.default` — `services.burndown` systemd unit + optional `tailscale serve` oneshot. Uses `DynamicUser` + `StateDirectory=burndown` so the cache file lives at `/var/lib/burndown/notion-cache.json`. Reads `NOTION_API_KEY` from `services.burndown.envFile` (default `/etc/burndown.env`, mode 0600).

Local build smoke test (Mac): `cd nix && nix build .#packages.aarch64-darwin.default && deno run -A result/build/index.js`.
```

- [ ] **Step 7: Propose commit to user**

Propose:

```
feat(nix): add hermetic build derivation + NixOS service module

Two-derivation build:
- FOD `burndown-deno-cache` runs `deno install --allow-scripts --frozen`
  with network, pinned to a sha256 derived from deno.lock contents
- Sandboxed `notion-task-burndown-chart` runs `vite build` with
  --cached-only against the pre-fetched cache, then installs build/
  + node_modules + manifest files into $out

Service module declares `services.burndown` with options for port,
origin, envFile, tailscaleServe — systemd unit uses DynamicUser +
StateDirectory=burndown for cache persistence across rebuilds.
Optional `burndown-tailscale-serve` oneshot exposes the app on tailnet
HTTPS once tailscaled comes online.
```

On approval:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && git add nix/ CLAUDE.md && git commit -m "feat(nix): add hermetic build derivation + NixOS service module" -m "Two-derivation build: FOD burndown-deno-cache runs deno install --allow-scripts --frozen with network, pinned to a sha256 derived from deno.lock. Sandboxed notion-task-burndown-chart runs vite build with --cached-only, installs build/ + node_modules + manifest files into \$out." -m "Service module declares services.burndown with options for port, origin, envFile, tailscaleServe — systemd unit uses DynamicUser + StateDirectory=burndown for cache persistence. Optional burndown-tailscale-serve oneshot exposes the app on tailnet HTTPS once tailscaled is online."
```

---

## Phase 4: Burndown `deploy/` — Terraform + wire-it flake + justfile

### Task 4.1: Remove old Pi-targeted `deploy/` content

The current `deploy/burndown.service.template` and `deploy/setup.sh` are Pi-specific and won't compose with NixOS. Remove them; we'll replace with OCI-targeted files in this same phase.

**Files:**

- Delete: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/burndown.service.template`
- Delete: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/setup.sh`

- [ ] **Step 1: Remove old Pi files**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && git rm deploy/burndown.service.template deploy/setup.sh
```

- [ ] **Step 2: Sanity-check `.deploy.env.example`**

Read `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/.deploy.env.example`. It currently has Pi-specific vars (PI_HOST, PI_USER, PI_DIR, APP_PORT, SERVE_PORT, ORIGIN). We'll replace it next.

### Task 4.2: Write `.deploy.env.example` (OCI-targeted)

**Files:**

- Modify: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/.deploy.env.example`

- [ ] **Step 1: Overwrite `.deploy.env.example`**

```bash
# Copy to .deploy.env (gitignored) and fill in.

# OCI tenancy compartment (root tenancy OCID — see global CLAUDE.md if unset).
OCI_COMPARTMENT_ID=ocid1.tenancy.oc1..<tenancy-ocid>

# 1Password path to the Notion integration secret used by the runtime.
SECRET_PATH="op://Personal/Notion Task Burndown Chart Notion Internal Integration Secret/credential"

# 1Password paths to Tailscale OAuth client used to mint auth keys.
TS_OAUTH_ID_PATH="op://Personal/Tailscale OAuth Client ID/credential"
TS_OAUTH_SECRET_PATH="op://Personal/Tailscale OAuth Client Secret/credential"

# Hostname assigned in the tailnet — also the OCI display name. Hits as
# https://notion-task-burndown-chart.tailee59b5.ts.net once tailscaled registers.
DEPLOY_HOSTNAME=notion-task-burndown-chart
TAILNET=tailee59b5
```

(`OCI_COMPARTMENT_ID` value lifted from the existing `nixos-ocp-tailscale-vm-iac/main.tf` — same tenancy.)

### Task 4.3: Add `deploy/main.tf`, `variables.tf`, `outputs.tf`, `terraform.tf`

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/main.tf`
- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/variables.tf`
- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/outputs.tf`
- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/terraform.tf`

- [ ] **Step 1: Write `terraform.tf`**

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
  }
}

provider "oci" {
  auth                = "SecurityToken"
  config_file_profile = "DEFAULT"
  region              = var.region
}
```

- [ ] **Step 2: Write `variables.tf`**

```hcl
variable "compartment_id" {
  type        = string
  description = "OCI tenancy/compartment OCID."
}

variable "region" {
  type        = string
  default     = "us-ashburn-1"
}

variable "ssh_public_key" {
  type    = string
  default = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO7ZCS39YKZ+E/U0aFXe6qfBTfPOgT6NWN7LoOddv7/0"
}

variable "display_name" {
  type    = string
  default = "notion-task-burndown-chart"
}
```

- [ ] **Step 3: Write `main.tf`**

```hcl
module "vm" {
  source = "git::https://github.com/alexjmiller5/nixos-ocp-tailscale-vm-iac.git//terraform/oci-vm?ref=main"

  compartment_id      = var.compartment_id
  region              = var.region
  vcn_cidr            = "10.0.0.0/16"
  subnet_cidr         = "10.0.0.0/24"
  ocpus               = 1
  memory_gb           = 6
  boot_volume_size_gb = 50
  display_name        = var.display_name
  ssh_public_key      = var.ssh_public_key
}
```

- [ ] **Step 4: Write `outputs.tf`**

```hcl
output "instance_public_ip" {
  value = module.vm.instance_public_ip
}

output "instance_ocid" {
  value = module.vm.instance_ocid
}
```

- [ ] **Step 5: `terraform init` + `terraform validate`**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && terraform init && terraform validate
```

Expected: init succeeds (fetches the `git::` module + OCI provider), then `Success! The configuration is valid.`

If init fails with auth errors against GitHub, ensure the IaC repo's Phase 1 push has propagated.

### Task 4.4: Write `deploy/flake.nix`

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/flake.nix`

- [ ] **Step 1: Write `flake.nix`**

```nix
{
  description = "Burndown OCI VM — wires iac base + burndown service module";

  inputs = {
    nixpkgs.url   = "github:NixOS/nixpkgs/nixos-unstable";
    iac.url       = "github:alexjmiller5/nixos-ocp-tailscale-vm-iac";
    burndown.url  = "path:../nix";
  };

  outputs = { self, nixpkgs, iac, burndown, ... }: {
    nixosConfigurations.notion-task-burndown-chart =
      nixpkgs.lib.nixosSystem {
        system = "aarch64-linux";
        modules = [
          ./hardware-configuration.nix
          iac.nixosModules.base
          burndown.nixosModules.default
          ({ ... }: {
            networking.hostName = "notion-task-burndown-chart";
            time.timeZone = "America/New_York";
            services.burndown = {
              enable = true;
              origin = "https://notion-task-burndown-chart.tailee59b5.ts.net";
            };
          })
        ];
      };
  };
}
```

- [ ] **Step 2: Create a placeholder `hardware-configuration.nix` to satisfy flake-check pre-deploy**

Write a stub (will be overwritten by the real one fetched after first install):

```nix
{ modulesPath, ... }: {
  imports = [ (modulesPath + "/profiles/qemu-guest.nix") ];
  # placeholder — replaced by deploy/fetch-hardware-config after first install
  boot.loader.grub.device = "nodev";
  fileSystems."/" = { device = "/dev/sda1"; fsType = "ext4"; };
  system.stateVersion = "25.11";
}
```

- [ ] **Step 3: Add `deploy/secrets.nix` to `.gitignore`**

Read root `.gitignore`. If `deploy/secrets.nix` isn't already covered (current entry is `secrets.nix` at top level — confirm), add `deploy/secrets.nix` and `deploy/.deploy.env`.

- [ ] **Step 4: `nix flake check` on `deploy/`**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && nix flake check --no-build
```

Expected: no evaluation errors. The placeholder `hardware-configuration.nix` is fine for static check; real build happens on the VM after bootstrap.

### Task 4.5: Write `deploy/justfile`

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/justfile`

- [ ] **Step 1: Write `justfile`**

```just
set dotenv-load := true
set dotenv-filename := ".deploy.env"

default:
  @just --list

# OCI auth — refresh expiring SecurityToken.
oci-auth:
  oci session authenticate --region us-ashburn-1 --profile-name DEFAULT

# Mint a Tailscale auth key via OAuth and write deploy/secrets.nix.
mint-tailscale-key:
  #!/usr/bin/env bash
  set -euo pipefail
  CLIENT_ID=$(op read "$TS_OAUTH_ID_PATH")
  CLIENT_SECRET=$(op read "$TS_OAUTH_SECRET_PATH")
  TOKEN=$(curl -fsS \
    -d "client_id=$CLIENT_ID" -d "client_secret=$CLIENT_SECRET" \
    https://api.tailscale.com/api/v2/oauth/token | jq -r .access_token)
  AUTH_KEY=$(curl -fsS -X POST \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"capabilities":{"devices":{"create":{"reusable":false,"ephemeral":false,"preauthorized":true,"tags":["tag:oauth-generated"]}}},"expirySeconds":7776000}' \
    https://api.tailscale.com/api/v2/tailnet/-/keys | jq -r .key)
  printf '{ tailscaleAuthKey = "%s"; }\n' "$AUTH_KEY" > secrets.nix
  chmod 600 secrets.nix
  echo "✓ secrets.nix written (mode 600)."

# Terraform wrappers.
init:
  terraform init
plan:
  terraform plan -var="compartment_id=$OCI_COMPARTMENT_ID"
apply:
  terraform apply -var="compartment_id=$OCI_COMPARTMENT_ID"
destroy:
  terraform destroy -var="compartment_id=$OCI_COMPARTMENT_ID"
ip:
  @terraform output -raw instance_public_ip

# SSH into the freshly-provisioned Ubuntu instance (pre-nixos-infect).
ssh-ubuntu:
  #!/usr/bin/env bash
  IP=$(terraform output -raw instance_public_ip)
  ssh ubuntu@$IP

# SSH as root (post-NixOS).
ssh:
  #!/usr/bin/env bash
  IP=$(terraform output -raw instance_public_ip)
  ssh root@$IP

# Install NixOS via nixos-infect on the freshly-provisioned Ubuntu host.
install-infect:
  #!/usr/bin/env bash
  set -euo pipefail
  IP=$(terraform output -raw instance_public_ip)
  echo "==> Staging /etc/nixos/ on the instance..."
  ssh -o StrictHostKeyChecking=accept-new ubuntu@$IP 'sudo mkdir -p /etc/nixos'
  # Ship the deploy flake + secrets + a tiny configuration.nix that imports the flake's nixosConfigurations
  rsync -av --exclude='.terraform' --exclude='terraform.tfstate*' --exclude='*.tfvars' \
    ./ ubuntu@$IP:/tmp/burndown-deploy/
  # Also ship the local burndown nix/ dir (because the flake input `path:../nix` resolves relative to deploy/)
  rsync -av ../nix/ ubuntu@$IP:/tmp/burndown-nix/
  ssh ubuntu@$IP 'sudo mv /tmp/burndown-deploy/* /etc/nixos/ && sudo mv /tmp/burndown-nix /etc/nixos/burndown-nix && sudo chown -R root:root /etc/nixos'
  echo "==> Running nixos-infect..."
  ssh ubuntu@$IP 'curl https://raw.githubusercontent.com/elitak/nixos-infect/master/nixos-infect | sudo NIX_CHANNEL=nixos-unstable bash -x 2>&1 | tee /tmp/infect.log'
  echo ""
  echo "✓ System will reboot into NixOS. Wait ~3 min, then: just fetch-hardware-config && just update-nixos"

# Copy hardware-configuration.nix back from the VM after first install.
fetch-hardware-config:
  #!/usr/bin/env bash
  set -euo pipefail
  IP=$(terraform output -raw instance_public_ip)
  scp root@$IP:/etc/nixos/hardware-configuration.nix .
  echo "✓ hardware-configuration.nix saved. Commit and run 'just update-nixos'."

# Push flake + rebuild on the VM.
update-nixos:
  #!/usr/bin/env bash
  set -euo pipefail
  IP=$(terraform output -raw instance_public_ip)
  rsync -av --exclude='.terraform' --exclude='terraform.tfstate*' --exclude='*.tfvars' \
    ./ root@$IP:/etc/nixos/
  rsync -av ../nix/ root@$IP:/etc/nixos/burndown-nix/
  # Rewrite the path:../nix input to point at the staged copy
  ssh root@$IP "sed -i 's|path:../nix|path:./burndown-nix|' /etc/nixos/flake.nix"
  ssh root@$IP "cd /etc/nixos && nix flake update burndown && nixos-rebuild switch --flake .#notion-task-burndown-chart"

# Push the Notion API key from 1Password to /etc/burndown.env (mode 600).
set-secret:
  #!/usr/bin/env bash
  set -euo pipefail
  IP=$(terraform output -raw instance_public_ip)
  KEY=$(op read "$SECRET_PATH")
  printf 'NOTION_API_KEY=%s\n' "$KEY" | \
    ssh root@$IP "tee /etc/burndown.env > /dev/null && chmod 600 /etc/burndown.env"
  ssh root@$IP "systemctl try-restart burndown.service" || true
  echo "✓ Secret installed."

# Full first-deploy.
deploy-bootstrap: mint-tailscale-key apply
  @echo "==> Waiting 60s for instance to boot..."
  sleep 60
  just install-infect
  @echo ""
  @echo "==> Wait ~3 min for NixOS to come up, then run:"
  @echo "    just fetch-hardware-config"
  @echo "    just update-nixos"
  @echo "    just set-secret"

logs:
  #!/usr/bin/env bash
  IP=$(terraform output -raw instance_public_ip)
  ssh root@$IP "journalctl -u burndown.service -f -n 50"

status:
  #!/usr/bin/env bash
  IP=$(terraform output -raw instance_public_ip)
  ssh root@$IP "systemctl status burndown.service --no-pager; echo; tailscale status; echo; tailscale serve status"
```

- [ ] **Step 2: Wire the install-infect path issue**

Note in the justfile that `install-infect` rewrites the `path:../nix` reference inside the staged flake. Why: on the VM, the layout is `/etc/nixos/flake.nix` and `/etc/nixos/burndown-nix/`, so the input must point at `./burndown-nix`, not `../nix`. The same rewrite happens in `update-nixos`. This avoids needing to commit a different flake variant for the VM.

Actually — to avoid the brittle sed: introduce a small post-process script. Re-do step 1's `install-infect` and `update-nixos` to call this:

Create `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/scripts/rewrite-flake-input.sh`:

```bash
#!/usr/bin/env bash
# Rewrite the burndown flake input from path:../nix to path:./burndown-nix
# in /etc/nixos/flake.nix on the VM. Idempotent.
set -euo pipefail
sed -i 's|path:\.\./nix|path:./burndown-nix|g' /etc/nixos/flake.nix
```

Then in the justfile, `install-infect` should `scp` this script and run it after `nixos-infect`; `update-nixos` runs it after rsync. Update the two recipes accordingly:

- `install-infect`'s nixos-infect line stays, but afterwards we don't need the sed (nixos-infect runs before any nix evaluation, so the rewrite must happen BEFORE infect runs the flake — adjust accordingly).
- `update-nixos`'s `ssh root@$IP "sed -i ..."` becomes `ssh root@$IP "bash /etc/nixos/scripts/rewrite-flake-input.sh"`.

Apply this refactor and re-validate the justfile is syntactically clean by running `just --list` in `deploy/`.

- [ ] **Step 3: Validate the justfile parses**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just --list
```

Expected: the recipe list prints. If parsing fails, fix the syntax error.

### Task 4.6: Propose commit for Phase 4

- [ ] **Step 1: Propose commit**

```
feat(deploy): replace Pi deploy stack with OCI Terraform + flake wiring

Drops the Pi-targeted systemd unit template + setup.sh in favor of:
- deploy/main.tf et al. — Terraform consuming the nixos-ocp-tailscale-vm-iac module
- deploy/flake.nix — wires iac.nixosModules.base + burndown.nixosModules.default
  into nixosConfigurations.notion-task-burndown-chart
- deploy/justfile — recipes for mint-tailscale-key, deploy-bootstrap,
  install-infect, fetch-hardware-config, update-nixos, set-secret,
  status/logs
- .deploy.env.example — new env vars (OCI compartment, 1Password paths,
  tailnet/hostname)

Hardware-configuration.nix is a placeholder until first install — the
real one gets fetched via `just fetch-hardware-config` post-infect.
```

On approval:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && git add deploy/ .deploy.env.example .gitignore && git commit -m "feat(deploy): replace Pi deploy stack with OCI Terraform + flake wiring" -m "Drops the Pi-targeted systemd unit template + setup.sh in favor of:" -m "- deploy/main.tf et al. — Terraform consuming the nixos-ocp-tailscale-vm-iac module" -m "- deploy/flake.nix — wires iac.nixosModules.base + burndown.nixosModules.default into nixosConfigurations.notion-task-burndown-chart" -m "- deploy/justfile — recipes for mint-tailscale-key, deploy-bootstrap, install-infect, fetch-hardware-config, update-nixos, set-secret, status/logs" -m "- .deploy.env.example — new env vars (OCI compartment, 1Password paths, tailnet/hostname)"
```

- [ ] **Step 2: Push burndown branch to GitHub**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && git push origin main
```

(Phase 5 needs commits to be on GitHub so `terraform init` on the VM resolves remote modules.)

---

## Phase 5: OCI bootstrap & verify (real infra)

This phase touches real Oracle Cloud + your Tailscale tenant. Each step is irreversible-ish (apply creates billable-but-free resources; the auth key is one-time-use). **Walk through these tasks one at a time with the user.**

### Task 5.1: Pre-flight

- [ ] **Step 1: Confirm `.deploy.env` is filled in**

Run:

```bash
cat /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/.deploy.env 2>/dev/null || echo "MISSING — create from .deploy.env.example"
```

If missing, copy from the example file and fill in. The example values are mostly correct; just verify them.

- [ ] **Step 2: Confirm `op signin` is active**

Run:

```bash
op account list && op vault list
```

Expected: lists your Personal vault. If unauthenticated, sign in with `eval $(op signin)`.

- [ ] **Step 3: Confirm OCI session is fresh**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just oci-auth
```

Browser opens; complete auth flow. (Tokens last ~1 hour.)

- [ ] **Step 4: Confirm `tag:oauth-generated` exists in your tailnet ACL**

Per the global CLAUDE.md note, this is already configured. Verify:

```bash
TOKEN=$(curl -fsS -d "client_id=$(op read 'op://Personal/Tailscale OAuth Client ID/credential')" -d "client_secret=$(op read 'op://Personal/Tailscale OAuth Client Secret/credential')" https://api.tailscale.com/api/v2/oauth/token | jq -r .access_token)
curl -fsS -H "Authorization: Bearer $TOKEN" https://api.tailscale.com/api/v2/tailnet/-/acl | jq '.tagOwners'
```

Expected: object containing `"tag:oauth-generated": [...]`. If missing, STOP and ask the user to add it.

### Task 5.2: Mint auth key + apply Terraform

- [ ] **Step 1: Mint the Tailscale auth key**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just mint-tailscale-key
```

Expected: prints "✓ secrets.nix written (mode 600)". Verify:

```bash
ls -la /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/secrets.nix
cat /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy/secrets.nix | head -1
```

Expected: file mode `-rw-------`, contents start with `{ tailscaleAuthKey = "tskey-`.

- [ ] **Step 2: Plan**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just init && just plan
```

Expected: plan describes adding 1 VCN + 1 IGW + 1 subnet + 1 default route + 1 instance. Verify the instance:

- `display_name = "notion-task-burndown-chart"`
- shape `VM.Standard.A1.Flex`, `ocpus=1`, `memory_in_gbs=6`
- subnet inside `10.0.0.0/16`
- ssh_authorized_keys matches the ed25519 key in `variables.tf`

- [ ] **Step 3: Apply**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just apply
```

If "Out of host capacity" — per the spec, wait and retry later, do not switch regions. Re-run `just apply` after 15-60 min.

On success: terraform reports `instance_public_ip = "X.X.X.X"`.

### Task 5.3: nixos-infect

- [ ] **Step 1: Wait 60s for instance boot, then run install-infect**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && sleep 60 && just install-infect
```

Expected: rsync output, then nixos-infect runs (~5-10 min). System reboots automatically into NixOS.

If the rsync fails with "permission denied" on /etc/nixos, ensure step 1 of `install-infect` does `sudo mkdir -p` first — it does.

- [ ] **Step 2: Wait ~3 minutes for NixOS to come up, then verify SSH-as-root works**

Run:

```bash
sleep 180 && cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just ssh "uname -a; cat /etc/os-release | head -2"
```

Expected: NixOS kernel, `NAME="NixOS"`.

If SSH fails, the VM may still be rebooting — wait another 60s and retry.

### Task 5.4: Fetch hardware-configuration, rebuild from real flake

- [ ] **Step 1: Fetch the real `hardware-configuration.nix`**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just fetch-hardware-config
```

Expected: file overwrites placeholder. `diff` it against the placeholder to confirm content changed.

- [ ] **Step 2: Commit the real hardware-configuration**

Propose:

```
feat(deploy): real hardware-configuration.nix from first install

Replaces placeholder with what the VM actually has after nixos-infect.
```

On approval:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && git add deploy/hardware-configuration.nix && git commit -m "feat(deploy): real hardware-configuration.nix from first install" && git push
```

- [ ] **Step 3: Run `update-nixos` to apply the full flake**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just update-nixos
```

Expected: rsync, then `nixos-rebuild switch` runs on the VM. Builds the burndown derivation hermetically (the FOD will fetch deps once, then the sandboxed build runs). Eventually: `activating the configuration...` and the new generation is active. Should take 5-15 min on the small ARM VM (Nix evaluation + npm dep fetch dominate).

If the build fails on the VM with "hash mismatch in fixed-output derivation" for `burndown-deno-cache`, the FOD hash committed in Phase 3 differs between Mac and Linux. This shouldn't happen (FODs are deterministic), but if it does: copy the new hash, paste into `nix/package.nix`, commit, push, re-run `just update-nixos`.

### Task 5.5: Install the Notion secret + verify burndown is running

- [ ] **Step 1: Push the Notion API key**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just set-secret
```

Expected: "✓ Secret installed."

- [ ] **Step 2: Check service status**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just status
```

Expected:

- `burndown.service`: `active (running)`
- `tailscale status`: hostname `notion-task-burndown-chart`, online, tagged `tag:oauth-generated`
- `tailscale serve status`: HTTPS 443 → http://localhost:3000

- [ ] **Step 3: Hit the URL from the local Mac (must be on tailnet)**

Run:

```bash
curl -sS -o /tmp/burndown-prod.html -w "%{http_code}\n" https://notion-task-burndown-chart.tailee59b5.ts.net/
```

Expected: HTTP 200. Open in browser too:

```bash
open https://notion-task-burndown-chart.tailee59b5.ts.net/
```

Chart should render. The first sync runs in the background — give it ~30s, refresh, and verify chart populates from Notion data.

- [ ] **Step 4: Check the cache file landed in StateDirectory**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just ssh "ls -la /var/lib/burndown/"
```

Expected: `notion-cache.json` present, owned by the DynamicUser, mode 0644-ish.

- [ ] **Step 5: Persistence smoke test — rebuild and verify cache survives**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/deploy && just ssh "stat -c '%Y' /var/lib/burndown/notion-cache.json" > /tmp/cache-mtime-before
just update-nixos
just ssh "stat -c '%Y' /var/lib/burndown/notion-cache.json" > /tmp/cache-mtime-after
diff /tmp/cache-mtime-before /tmp/cache-mtime-after
```

Expected: mtime UNCHANGED (the rebuild does not touch the cache). If mtime changed, the cache may have been recreated — investigate, but this is non-blocking if the contents are still valid.

### Task 5.6: Lock-in commit for Phase 5

- [ ] **Step 1: Propose final Phase 5 commit (if any artifacts changed)**

Likely no code changes here unless step 3 of Task 5.4 needed a hash-fix commit. If so, propose:

```
fix(nix): pin Linux FOD hash for burndown-deno-cache

The Mac and Linux deno install paths produced different FOD output
hashes (expected — the cache contains arch-specific .so/.dylib for
npm postinstall scripts). Pinning to the Linux hash so VM rebuilds
don't pull from a CA mismatch.
```

If no commit needed, skip.

---

## Phase 6: Pi decommission

Burndown is running on OCI. Now retire the Pi.

### Task 6.1: Stop the Pi service

- [ ] **Step 1: Confirm OCI is healthy one more time**

Re-run Task 5.5 Step 3 — confirm `https://notion-task-burndown-chart.tailee59b5.ts.net/` returns 200 and the chart renders correctly with up-to-date data.

- [ ] **Step 2: Stop the Pi service**

The current Pi host details are in `.deploy.env` (the OLD version, pre-Phase 4 overwrite — recover from git if needed):

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && git show HEAD~7:.deploy.env.example 2>/dev/null | grep -E '^(PI_|SERVE_PORT)'
```

(Adjust `HEAD~7` if the burndown commit history has more steps. Goal: find the original Pi-host string.)

Or simpler — the Pi is reachable via Tailscale MagicDNS, hostname likely something like `<hostname>.tailee59b5.ts.net`. Ask the user to confirm the Pi's tailnet hostname.

On the Pi:

```bash
ssh <pi-user>@<pi-host> 'sudo systemctl disable --now burndown.service && sudo tailscale serve --https=8443 off'
```

Expected: service stops; tailscale serve mapping removed.

- [ ] **Step 3: Optionally remove the unit on the Pi**

```bash
ssh <pi-user>@<pi-host> 'sudo rm -f /etc/systemd/system/burndown.service /etc/burndown.env && sudo systemctl daemon-reload'
```

(Keeps the Pi's cache file under `$PI_DIR` in case you want it as evidence; doesn't delete it.)

### Task 6.2: Update burndown repo's `CLAUDE.md`

**Files:**

- Modify: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/CLAUDE.md`

- [ ] **Step 1: Rewrite the "Deployment" section**

Find the "## Deployment" section (mentions Raspberry Pi, systemd, tailscale serve). Replace entirely with:

```markdown
## Deployment

Production runs on an Oracle Cloud Always Free ARM VM in `us-ashburn-1`, registered to the tailnet as `notion-task-burndown-chart`, exposed at `https://notion-task-burndown-chart.tailee59b5.ts.net` via `tailscale serve` (HTTPS 443, tailnet-only).

- `nix/` — hermetic build derivation + NixOS service module (see "Nix module + hermetic build" above).
- `deploy/` — Terraform (consumes `git::https://github.com/alexjmiller5/nixos-ocp-tailscale-vm-iac.git//terraform/oci-vm`) + a wire-it flake + justfile recipes.
  - `just deploy-bootstrap` — first-deploy: mint auth key, terraform apply, nixos-infect.
  - `just update-nixos` — routine redeploy.
  - `just set-secret` — push NOTION_API_KEY from 1Password to `/etc/burndown.env`.
  - `just status` / `just logs` — operational.
- Cache (`notion-cache.json`) lives at `/var/lib/burndown/` via systemd `StateDirectory`. Persists across `nixos-rebuild switch`.
- Tailscale auth keys are minted from the OAuth client in 1Password (Personal vault) and tagged `tag:oauth-generated` per global CLAUDE.md.
```

- [ ] **Step 2: Verify no more Pi references remain**

```bash
grep -n -i 'raspberry\|\bpi\b\|PI_USER\|PI_HOST\|PI_DIR\|burndown\.service\.template\|setup\.sh' /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart/CLAUDE.md
```

Expected: empty output. Fix any remaining references.

- [ ] **Step 3: Propose commit**

```
chore: decommission Pi deploy, update CLAUDE.md to reflect OCI

Burndown is now running on OCI in us-ashburn-1. Updates the
Deployment section of CLAUDE.md accordingly. Pi service has been
stopped + disabled out-of-band; this commit just brings the docs
into sync.
```

On approval:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart && git add CLAUDE.md && git commit -m "chore: decommission Pi deploy, update CLAUDE.md to reflect OCI" -m "Burndown is now running on OCI in us-ashburn-1. Updates the Deployment section of CLAUDE.md accordingly. Pi service has been stopped + disabled out-of-band; this commit just brings the docs into sync." && git push
```

---

## Phase 7: Exit-node module extraction (cleanup)

This is independent of the burndown migration — pure cleanup. Producing a module that's not used by anything yet, but available for future deploys.

### Task 7.1: Create the GitHub repo

- [ ] **Step 1: Create via `gh` CLI**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects && gh repo create alexjmiller5/tailscale-exit-node-nixos-module --public --description "NixOS module exposing services.tailscale-exit-node for NAT-based exit-node operation" --clone
```

Expected: repo created on GitHub, cloned locally at `/Users/alexmiller/Desktop/coding/active-projects/tailscale-exit-node-nixos-module/`.

### Task 7.2: Populate the new repo

**Files:**

- Create: `/Users/alexmiller/Desktop/coding/active-projects/tailscale-exit-node-nixos-module/flake.nix`
- Create: `/Users/alexmiller/Desktop/coding/active-projects/tailscale-exit-node-nixos-module/module.nix`
- Create: `/Users/alexmiller/Desktop/coding/active-projects/tailscale-exit-node-nixos-module/README.md`

- [ ] **Step 1: Write `flake.nix`**

```nix
{
  description = "NixOS module — Tailscale exit node (NAT masquerade + --advertise-exit-node)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

  outputs = { self, nixpkgs }: {
    nixosModules.default = import ./module.nix;
  };
}
```

- [ ] **Step 2: Write `module.nix`**

```nix
{ config, lib, ... }:
let cfg = config.services.tailscale-exit-node; in {
  options.services.tailscale-exit-node = {
    enable = lib.mkEnableOption "Tailscale exit node (NAT masquerade for tailnet traffic).";
    externalInterface = lib.mkOption {
      type = lib.types.str;
      default = "ens3";
      description = "WAN-facing network interface (OCI default: ens3).";
    };
  };

  config = lib.mkIf cfg.enable {
    networking.nat = {
      enable = true;
      externalInterface = cfg.externalInterface;
      internalInterfaces = [ "tailscale0" ];
    };
    services.tailscale.extraUpFlags = [ "--advertise-exit-node" ];
  };
}
```

- [ ] **Step 3: Write `README.md`**

````markdown
# tailscale-exit-node-nixos-module

NixOS flake module that turns a host into a Tailscale exit node — NAT masquerade from `tailscale0` to a chosen external interface, plus `--advertise-exit-node` on the tailscaled daemon.

## Usage

In your VM's deploy flake:

```nix
{
  inputs.exit-node.url = "github:alexjmiller5/tailscale-exit-node-nixos-module";

  outputs = { self, nixpkgs, exit-node, ... }: {
    nixosConfigurations.my-vm = nixpkgs.lib.nixosSystem {
      system = "aarch64-linux";
      modules = [
        exit-node.nixosModules.default
        {
          services.tailscale-exit-node = {
            enable = true;
            externalInterface = "ens3";  # default — change for non-OCI hosts
          };
        }
      ];
    };
  };
}
```
````

## Options

- `services.tailscale-exit-node.enable` — bool, default `false`
- `services.tailscale-exit-node.externalInterface` — str, default `"ens3"` (OCI VM convention; AWS/GCP differ)

## What it does

- `networking.nat`: enables NAT, masquerades traffic from `tailscale0` to the external interface.
- `services.tailscale.extraUpFlags`: adds `--advertise-exit-node` so the device offers itself as an exit node in the tailnet.

Tailscale tailnet ACL must approve this device as an exit node — see Tailscale docs.

Stack version target: NixOS 25.11.

````

- [ ] **Step 4: Validate the flake**

Run:
```bash
cd /Users/alexmiller/Desktop/coding/active-projects/tailscale-exit-node-nixos-module && nix flake check --no-build
````

Expected: no errors.

- [ ] **Step 5: Propose commit and push**

```
initial commit: tailscale-exit-node NixOS module flake

Module exposes services.tailscale-exit-node with a single option for
the external interface. Drop-in for VMs that want to be exit nodes;
deploy stacks import it via flake input + `enable = true`.
```

On approval:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/tailscale-exit-node-nixos-module && git add -A && git commit -m "initial commit: tailscale-exit-node NixOS module flake" -m "Module exposes services.tailscale-exit-node with a single option for the external interface. Drop-in for VMs that want to be exit nodes; deploy stacks import it via flake input + enable = true." && git push -u origin main
```

---

## Phase 8: Changedetection refactor (cleanup)

Rename the existing repo, restructure into `nix/` (module) + `deploy/` (Terraform + wire-it flake), have it consume the IaC library.

### Task 8.1: Rename the GitHub repo + local directory

- [ ] **Step 1: Rename via `gh`**

Run:

```bash
gh repo rename --repo alexjmiller5/change-detection-deployment changedetection.io-tailscale-nixos-module
```

Expected: repo renamed on GitHub. Old URL redirects.

- [ ] **Step 2: Rename the local directory**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects && mv change-detection-deployment changedetection.io-tailscale-nixos-module
```

- [ ] **Step 3: Update local git remote URL**

Run:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/changedetection.io-tailscale-nixos-module && git remote set-url origin https://github.com/alexjmiller5/changedetection.io-tailscale-nixos-module.git && git remote -v
```

Expected: origin URL updated.

### Task 8.2: Restructure into `nix/` + `deploy/`

**Files:**

- Create dir: `nix/` and `deploy/` inside the renamed repo
- Move: `flake.nix`, `configuration.nix` into a split between `nix/` (module bits) and `deploy/` (deploy bits)
- Move: `main.tf`, `variables.tf`, `outputs.tf`, `terraform.tf`, `justfile`, `hardware-configuration.nix` into `deploy/`

- [ ] **Step 1: Create the subdirectories**

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/changedetection.io-tailscale-nixos-module && mkdir -p nix deploy
```

- [ ] **Step 2: Write `nix/module.nix`**

Lift the changedetection-specific bits from `configuration.nix` into an option-gated module. Bare-NixOS bits (firewall, openssh, tailscale daemon, root key, stateVersion) are moved to nowhere — they come from `iac.nixosModules.base`.

```nix
{ config, lib, pkgs, ... }:
let cfg = config.services.changedetection; in {
  options.services.changedetection = {
    enable = lib.mkEnableOption "changedetection.io stack (Podman-based)";
    baseUrl = lib.mkOption {
      type = lib.types.str;
      description = "Public BASE_URL the app emits in links/redirects.";
    };
    funnel = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether to expose port 5000 publicly via tailscale funnel.";
    };
    timezone = lib.mkOption {
      type = lib.types.str;
      default = "America/New_York";
    };
    containerNetwork = lib.mkOption {
      type = lib.types.str;
      default = "changedetection-net";
    };
  };

  config = lib.mkIf cfg.enable {
    virtualisation.podman = {
      enable = true;
      dockerCompat = true;
      defaultNetwork.settings.dns_enabled = true;
    };

    virtualisation.oci-containers.backend = "podman";

    systemd.services."podman-network-${cfg.containerNetwork}" = {
      description = "Create podman network for changedetection";
      after = [ "podman.service" ];
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.podman ];
      script = ''
        podman network exists ${cfg.containerNetwork} || podman network create ${cfg.containerNetwork}
      '';
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
      };
    };

    virtualisation.oci-containers.containers.changedetection = {
      image = "ghcr.io/dgtlmoon/changedetection.io:latest";
      ports = [ "127.0.0.1:5000:5000" ];
      volumes = [ "changedetection-data:/datastore" ];
      environment = {
        PLAYWRIGHT_DRIVER_URL = "ws://browser-chrome:3000";
        TZ = cfg.timezone;
        FETCH_WORKERS = "5";
        BASE_URL = cfg.baseUrl;
        USE_X_SETTINGS = "1";
      };
      dependsOn = [ "browser-chrome" ];
      extraOptions = [ "--network=${cfg.containerNetwork}" ];
    };

    virtualisation.oci-containers.containers.browser-chrome = {
      image = "dgtlmoon/sockpuppetbrowser:latest";
      environment = {
        SCREEN_WIDTH = "1920";
        SCREEN_HEIGHT = "1024";
        SCREEN_DEPTH = "16";
        MAX_CONCURRENT_CHROME_PROCESSES = "5";
      };
      extraOptions = [ "--network=${cfg.containerNetwork}" ];
    };

    systemd.services.podman-changedetection.after = [ "podman-network-${cfg.containerNetwork}.service" ];
    systemd.services.podman-changedetection.requires = [ "podman-network-${cfg.containerNetwork}.service" ];
    systemd.services.podman-browser-chrome.after = [ "podman-network-${cfg.containerNetwork}.service" ];
    systemd.services.podman-browser-chrome.requires = [ "podman-network-${cfg.containerNetwork}.service" ];

    systemd.services.tailscale-funnel = lib.mkIf cfg.funnel {
      description = "Tailscale Funnel for changedetection.io";
      after = [ "tailscaled.service" ];
      wants = [ "tailscaled.service" ];
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.tailscale pkgs.jq ];
      script = ''
        while ! tailscale status --json 2>/dev/null | jq -e '.Self.Online' > /dev/null 2>&1; do
          sleep 5
        done
        tailscale funnel --bg 5000
      '';
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
      };
    };

    time.timeZone = lib.mkForce cfg.timezone;
  };
}
```

- [ ] **Step 3: Write `nix/flake.nix`**

```nix
{
  description = "changedetection.io NixOS service module — Podman containers + tailscale funnel";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

  outputs = { self, nixpkgs }: {
    nixosModules.default = import ./module.nix;
  };
}
```

- [ ] **Step 4: Move Terraform files into `deploy/`**

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/changedetection.io-tailscale-nixos-module && \
  git mv main.tf variables.tf outputs.tf terraform.tf justfile hardware-configuration.nix deploy/ && \
  git rm flake.nix configuration.nix
```

(The original `flake.nix` and `configuration.nix` are obsolete — replaced by `nix/flake.nix` + `nix/module.nix` for the module side and `deploy/flake.nix` (new) for the deploy stack side.)

- [ ] **Step 5: Write `deploy/flake.nix`**

```nix
{
  description = "Changedetection.io OCI VM — wires iac base + cd service module";

  inputs = {
    nixpkgs.url        = "github:NixOS/nixpkgs/nixos-25.11";
    iac.url            = "github:alexjmiller5/nixos-ocp-tailscale-vm-iac";
    changedetection.url = "path:../nix";
  };

  outputs = { self, nixpkgs, iac, changedetection, ... }: {
    nixosConfigurations.changedetection =
      nixpkgs.lib.nixosSystem {
        system = "aarch64-linux";
        modules = [
          ./hardware-configuration.nix
          iac.nixosModules.base
          changedetection.nixosModules.default
          ({ ... }: {
            networking.hostName = "changedetection";
            services.changedetection = {
              enable = true;
              baseUrl = "https://changedetection.tailee59b5.ts.net";
              funnel = true;
            };
          })
        ];
      };
  };
}
```

- [ ] **Step 6: Rewrite `deploy/main.tf` to use the IaC module**

Overwrite `deploy/main.tf`:

```hcl
locals {
  compartment_ocid = "ocid1.tenancy.oc1..<tenancy-ocid>"
}

provider "oci" {
  auth                = "SecurityToken"
  config_file_profile = "DEFAULT"
  region              = var.region
}

module "vm" {
  source = "git::https://github.com/alexjmiller5/nixos-ocp-tailscale-vm-iac.git//terraform/oci-vm?ref=main"

  compartment_id      = local.compartment_ocid
  region              = var.region
  vcn_cidr            = "10.1.0.0/16"
  subnet_cidr         = "10.1.0.0/24"
  ocpus               = 2
  memory_gb           = 12
  boot_volume_size_gb = 50
  display_name        = "changedetection-vm"
  ssh_public_key      = var.ssh_public_key
}
```

- [ ] **Step 7: Slim `deploy/variables.tf` to just what's needed**

Overwrite `deploy/variables.tf`:

```hcl
variable "region" {
  type    = string
  default = "us-ashburn-1"
}

variable "ssh_public_key" {
  type    = string
  default = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO7ZCS39YKZ+E/U0aFXe6qfBTfPOgT6NWN7LoOddv7/0"
}
```

- [ ] **Step 8: Slim `deploy/outputs.tf`**

Overwrite `deploy/outputs.tf`:

```hcl
output "instance_public_ip" {
  value = module.vm.instance_public_ip
}
```

- [ ] **Step 9: Update `deploy/justfile`**

Adjust paths in the existing `justfile` (which is the lifted-and-shifted exit-node-style one). Key changes:

- `update-nixos` line: ensure it rebuilds against `flake.nix` in cwd (`deploy/`), not the old top-level `flake.nix`.
- Add a step to ship `../nix/` to the VM alongside the deploy flake, and rewrite the `path:../nix` → `path:./changedetection-nix` (same trick as burndown).

This is structurally identical to the burndown `justfile` from Phase 4. Use it as a template, swap names.

- [ ] **Step 10: Validate**

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/changedetection.io-tailscale-nixos-module/nix && nix flake check --no-build
cd /Users/alexmiller/Desktop/coding/active-projects/changedetection.io-tailscale-nixos-module/deploy && nix flake check --no-build && terraform init -backend=false && terraform validate
```

Expected: all four checks pass.

### Task 8.3: Commit the refactor

- [ ] **Step 1: Update `CLAUDE.md` and `README.md` in the renamed repo**

Brief — point to the new layout, note the rename, drop references to the old monolithic structure.

- [ ] **Step 2: Propose commit**

```
refactor: split into nix/ (module) + deploy/ (Terraform + wire-it flake)

Mirrors the burndown repo's structure. The repo is now both:
- a NixOS module exposing services.changedetection (under nix/)
- a deploy stack that wires iac.nixosModules.base + this module
  into a working OCI VM (under deploy/)

Drops the duplicated bare-NixOS/Terraform code in favor of consuming
github:alexjmiller5/nixos-ocp-tailscale-vm-iac for the base module + Terraform
module. configuration.nix and the old flake.nix removed — their bits
moved into nix/module.nix and deploy/flake.nix respectively.
```

On approval:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/changedetection.io-tailscale-nixos-module && git add -A && git commit -m "refactor: split into nix/ (module) + deploy/ (Terraform + wire-it flake)" -m "Mirrors the burndown repo's structure. The repo is now both a NixOS module exposing services.changedetection (under nix/) and a deploy stack that wires iac.nixosModules.base + this module into a working OCI VM (under deploy/)." -m "Drops the duplicated bare-NixOS/Terraform code in favor of consuming github:alexjmiller5/nixos-ocp-tailscale-vm-iac for the base module + Terraform module. configuration.nix and the old flake.nix removed — their bits moved into nix/module.nix and deploy/flake.nix respectively." && git push
```

### Task 8.4: Optionally redeploy changedetection from the new structure

This is post-cleanup verification — only worth doing if the changedetection VM is currently running on the old structure and you want to prove the new structure deploys cleanly. Otherwise skip.

- [ ] **Step 1 (optional): Test redeploy**

If pursuing:

```bash
cd /Users/alexmiller/Desktop/coding/active-projects/changedetection.io-tailscale-nixos-module/deploy && just update-nixos
```

Expected: rebuild succeeds, containers continue running, baseUrl still resolves.

---

## Self-review

### Spec coverage

- ✅ "Burndown runs on OCI Always Free ARM VM" — Phases 1-5
- ✅ "Build is hermetic via Nix" — Phase 3
- ✅ "Production runtime stays on Deno" — Phase 3, module ExecStart uses pkgs.deno
- ✅ "nixos-ocp-tailscale-vm-iac becomes a pure library" — Phase 1
- ✅ "Exit-node specifics extracted to a new repo" — Phase 7
- ✅ "change-detection-deployment renamed/restructured" — Phase 8
- ✅ "Pi deployment fully decommissioned" — Phase 6
- ✅ "No agenix/sops-nix; secrets via EnvironmentFile + just set-secret" — Phase 4 justfile + Phase 5
- ✅ "Tailscale auth via OAuth → tag:oauth-generated" — Phase 4 justfile + Phase 5
- ✅ "Cache file at /var/lib/burndown via StateDirectory" — Phase 3 module
- ✅ "BURNDOWN_CACHE_PATH env var" — Phase 2 (TDD), Phase 3 module
- ✅ "Wait and retry on OCI capacity errors" — Phase 5.2 step 3

### Placeholder scan

- ✅ No "TBD" / "implement later" / "similar to Task N" / vague handwaving.
- ✅ FOD hash is explicitly handled (set to `lib.fakeHash`, build to surface, paste real value) rather than left as a placeholder.
- ✅ The Pi host's tailnet hostname is the one un-pinned value (we ask the user to confirm in Phase 6.1 Step 2) — acceptable since the Pi setup predates this plan.

### Type/name consistency

- `services.burndown.{enable,package,port,origin,envFile,tailscaleServe,serveHttpsPort}` — same options used in module.nix (Phase 3.2), deploy flake (Phase 4.4), and consistent with the spec.
- `services.changedetection.{enable,baseUrl,funnel,timezone,containerNetwork}` — same across Phase 8.2 module and Phase 8.2 deploy flake.
- `services.tailscale-exit-node.{enable,externalInterface}` — consistent in Phase 7.2 module and Phase 7.2 README.
- Hostname `notion-task-burndown-chart` — used in deploy flake (Phase 4.4), .deploy.env.example (Phase 4.2), Terraform display_name (Phase 4.3), Phase 5.5 verification, Phase 6.2 CLAUDE.md.
- Cache path `/var/lib/burndown/notion-cache.json` — module (Phase 3.2), CLAUDE.md updates (Phase 3.4 step 6, Phase 6.2).

No inconsistencies found.
