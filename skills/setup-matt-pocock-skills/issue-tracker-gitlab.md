# Issue tracker: GitLab through MCP

There is no built-in GitLab CLI provider. Do not invoke `glab` or select a GitLab provider. Use GitLab only when the user explicitly selects an already-configured MCP server that exposes the required issue tools.

During setup, configure `provider: "mcp"` and the confirmed `mcpServer` with `tracker_configure`. Record the actual available issue, comment, close, read, and relationship tools in the repo's tracker guide after checking the MCP tool catalog. Never invent tool names or assume the server can create labels, dependencies, or merge requests.

Describe GitLab-specific conventions (for example, issue versus merge request identity, labels, or blocking links) only when the configured server's tools support them and the user confirms the repo convention. If a required operation is unavailable, state the limitation and use a user-approved manual or delegated path.
