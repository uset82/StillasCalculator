# ChatGPT App Deployment

StillasCalculator now exposes a public Apps SDK MCP endpoint:

```text
https://stillascalculator.netlify.app/mcp
```

Use this URL when creating the app in ChatGPT developer mode.

## What ChatGPT Gets

- `list_scaffold_systems`: lists available scaffold systems and default dimensions.
- `estimate_scaffold_materials`: calculates bays, levels, and material quantities from a known scaffold length.
- `estimate_scaffold_for_location`: resolves an address or coordinate, selects a nearby building footprint, and calculates quantities.

All three tools are read-only planning-estimate tools and run without user OAuth. That keeps sign-in simple: users can use the calculator inside ChatGPT without the standalone site's ChatGPT/Codex device-code login.

The existing standalone app auth remains unchanged for `/api/ai/*`.

## Add To ChatGPT

1. In ChatGPT, enable developer mode under Settings -> Apps & Connectors -> Advanced settings.
2. Go to Settings -> Connectors -> Create.
3. Use:
   - Name: `StillasCalculator`
   - Description: `Estimate scaffolding bays, levels, and material quantities from a scaffold length or building location.`
   - Connector URL: `https://stillascalculator.netlify.app/mcp`
4. Create the connector, then open a new chat and add StillasCalculator from the More menu.

Official references:

- OpenAI Apps SDK deployment: https://developers.openai.com/apps-sdk/deploy
- Connect from ChatGPT: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth

## Auth Notes

This endpoint intentionally uses no app-specific sign-in because the public calculator does not expose private user data or perform destructive actions.

If StillasCalculator later needs saved user projects, private files, or account billing inside ChatGPT, replace no-auth tools with OAuth 2.1 per the Apps SDK auth guide. ChatGPT Apps auth is not the same as the standalone site's current device-code ChatGPT/Codex login.
