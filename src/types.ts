export interface AgentConfig {
    include?: string[];
    exclude?: string[];
    // The path to the directory containing this config file
    rootDir: string;
    // The path to the AGENTS.md file relative to rootDir (or absolute)
    agentFile: string;
}

export interface SymAgentsOptions {
    cwd: string;
    watch?: boolean;
}
