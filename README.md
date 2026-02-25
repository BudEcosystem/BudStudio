<a name="readme-top"></a>

<h2 align="center">
    <a href="https://budecosystem.com/"> <img width="50%" src="https://budecosystem.com/wp-content/themes/BudTheme/img/logo-white.png" /></a>
</h2>

<p align="center">AI-Powered Workspace with Autonomous Agents</p>

<p align="center">
    <a href="https://discord.gg/TDJ59cGV2X" target="_blank">
        <img src="https://img.shields.io/badge/discord-join-blue.svg?logo=discord&logoColor=white" alt="Discord">
    </a>
    <a href="https://budecosystem.com/" target="_blank">
        <img src="https://img.shields.io/badge/docs-view-blue" alt="Documentation">
    </a>
    <a href="https://budecosystem.com" target="_blank">
        <img src="https://img.shields.io/website?url=https://budecosystem.com&up_message=visit&up_color=blue" alt="Website">
    </a>
    <a href="https://github.com/BudEcosystem/BudStudio/blob/main/LICENSE" target="_blank">
        <img src="https://img.shields.io/static/v1?label=license&message=MIT&color=blue" alt="License">
    </a>
</p>



**[Bud Studio](https://budecosystem.com/)** is an AI-powered desktop workspace featuring autonomous agents that can think, plan, and execute complex tasks on your behalf. Built on a foundation of enterprise search and knowledge management, Bud Studio combines powerful AI capabilities with deep integration into your company's data and tools.

At its core is **Bud Agent** - an autonomous AI assistant that can access your local files, execute code, search the web, connect to your company's knowledge sources, and coordinate multi-step workflows, all while running securely in your desktop environment.

****

## Key Features

### Autonomous AI Agent
- **Local File Access:** Read, write, and edit files on your machine without uploads
- **Code Execution:** Run commands locally (bash, python, npm, etc.) with proper sandboxing
- **Multi-Step Planning:** Break down complex tasks and execute them autonomously
- **Tool Coordination:** Use multiple tools in sequence to accomplish goals
- **Memory & Context:** Remember past conversations and maintain context across sessions

### Intelligence & Search
- **Web Search:** Browse the web with Google PSE, Exa, Serper, or in-house scraper
- **RAG (Retrieval-Augmented Generation):** Hybrid search with knowledge graphs for uploaded files
- **Deep Research:** Multi-step agentic search for comprehensive answers
- **Semantic Search:** Enterprise-grade search across millions of documents

### Workspace Management
- **Workspace Isolation:** Each project gets its own secure workspace
- **File Browser:** Visual file tree for easy navigation
- **Cron Jobs:** Schedule recurring agent tasks
- **Inbox System:** Agent-managed notification and task queue

### Integrations
- **40+ Connectors:** Pull knowledge from Slack, Notion, Google Drive, GitHub, and more
- **MCP Protocol:** Extend capabilities with Model Context Protocol servers
- **Actions:** Give AI agents ability to interact with external systems
- **OAuth Support:** Secure authentication for third-party services

### Collaboration
- **Chat Sharing:** Share conversations with team members
- **User Management:** Role-based access control (basic, curator, admin)
- **Usage Analytics:** Track agent usage and performance
- **Feedback Gathering:** Collect feedback on agent responses

Bud Studio works with all major LLM providers (OpenAI, Anthropic, Gemini, etc.) and self-hosted models (Ollama, vLLM, etc.)

To learn more about the features, check out our [documentation](https://budecosystem.com/)!



## Desktop App

Bud Studio is available as a native desktop application built with Tauri, providing:

- **Native Performance:** Lightweight (~10MB) Rust-based desktop app
- **Embedded Frontend:** Next.js UI runs locally within the app
- **Keyboard Shortcuts:** Full keyboard navigation and shortcuts
- **System Integration:** Menu bar, system tray, and native dialogs
- **Multi-Window:** Open multiple Bud Studio windows
- **Configurable Backend:** Connect to local or remote backend servers

**Download:** Coming soon for macOS, Windows, and Linux



## Deployment

Bud Studio supports deployments in Docker, Kubernetes, Terraform, along with guides for major cloud providers.

See guides below:
- [Docker](https://budecosystem.com/deployment/local/docker) or [Quickstart](https://budecosystem.com/deployment/getting_started/quickstart) (best for most users)
- [Kubernetes](https://budecosystem.com/deployment/local/kubernetes) (best for large teams)
- [Terraform](https://budecosystem.com/deployment/local/terraform) (best for teams already using Terraform)
- Cloud-specific guides (best if specifically using [AWS EKS](https://budecosystem.com/deployment/cloud/aws/eks), [Azure VMs](https://budecosystem.com/deployment/cloud/azure), etc.)


## Enterprise Features

Bud Studio is built for teams of all sizes, from individual users to the largest global enterprises.

- **Enterprise Search:** Custom indexing and retrieval that remains performant and accurate for scales of up to tens of millions of documents
- **Security:** SSO (OIDC/SAML/OAuth2), RBAC, encryption of credentials, audit logs
- **Management UI:** Different user roles such as basic, curator, and admin
- **Document Permissioning:** Mirrors user access from external apps for RAG use cases
- **Agent Governance:** Control what tools agents can use and monitor their actions
- **Multi-Tenancy:** Isolated workspaces for different teams or customers






## Contributing

Looking to contribute? Please check out the [Contribution Guide](CONTRIBUTING.md) for more details.
