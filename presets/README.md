# Agent presets

Each immediate child directory of `presets/` is one DeepSeek Harness Agent preset and should be valid as a standalone preset root entry.

## Boundary

- `packages/` contains reusable, independently installable DSH plugins.
- `presets/` contains Agent compositions that choose prompts, tools, Skills, and preset-owned assets for a session.
- A preset may reference installed plugins, but keeping a plugin and preset in the same Git repository does not install the plugin into the DSH Host.

## Security

Presets in this repository are intended to be safe to publish. Do not commit API keys, access tokens, passwords, cookies, private endpoints containing credentials, or machine-specific secret files.

Credentials belong in the DSH Host/profile credential system. A preset may declare or reference capabilities that expect a credential to exist at runtime, but it must not embed the credential value.

Treat a preset as executable configuration: review every plugin row and preset-owned script before installing a preset from an untrusted source.

## Layout

```text
presets/
└── <preset-id>/
    ├── agent.cordis.yml
    ├── preset.yml
    ├── README.md
    ├── skills/              # optional, preset-owned Skills
    └── ...                  # optional preset-owned assets/plugins
```

Keep preset directories flat directly under `presets/`; DSH discovers immediate child directories as preset ids.

## Development

Prefer this Git checkout as the source of truth. During development, either configure DSH to scan this `presets/` directory as a user preset root or copy an individual preset into `$DSH_HOME/.agent-presets/` for dogfooding.

Presets are not npm packages and do not use the repository's Changesets release flow by default.
