/*
 * HiddenServer V2 — Vencord Custom Plugin
 * Premium UI/UX Global English Edition: Glassmorphism, 3D Keycaps, Live Dashboard Stats,
 * Pulsing Status Indicators, Password Eye Toggle & Shake Effects.
 * Developed by whiteexcellent
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    Button,
    FluxDispatcher,
    Forms,
    GuildStore,
    IconUtils,
    Modal,
    NavigationRouter,
    openModal,
    React,
    ScrollerThin,
    SelectedGuildStore,
    TextInput,
    useState
} from "@webpack/common";

export interface HiddenServerConfig {
    id: string;
    shortcut: string;
    password: string;
}

const DEFAULT_SERVERS: HiddenServerConfig[] = [
    {
        id: "123456789012345678",
        shortcut: "Alt+T",
        password: "1234"
    }
];

function ControlCenterSettingsComponent({ closePluginSettings }: { closePluginSettings?: () => void; }) {
    return (
        <div style={{ padding: "8px 0" }}>
            <Forms.FormText style={{ marginBottom: 12, color: "var(--text-normal)" }}>
                Open the control center to show, hide, or manage your hidden servers.
            </Forms.FormText>
            <Button
                variant="primary"
                onClick={() => {
                    closePluginSettings?.();
                    openModal(modalProps => (
                        <ControlCenterModal modalProps={modalProps} />
                    ));
                }}
            >
                🔒 Open Control Center
            </Button>
        </div>
    );
}

export const settings = definePluginSettings({
    controlCenterButton: {
        type: OptionType.COMPONENT,
        description: "Hidden Server Management",
        component: ControlCenterSettingsComponent
    },
    autoRelockOnBlur: {
        type: OptionType.BOOLEAN,
        description: "Auto-lock all servers when window loses focus or minimizes",
        default: true
    },
    autoRelockTimeoutMinutes: {
        type: OptionType.SELECT,
        description: "Auto-relock timer for unlocked servers",
        options: [
            { label: "Disabled", value: 0 },
            { label: "5 Minutes", value: 5 },
            { label: "10 Minutes", value: 10 },
            { label: "30 Minutes", value: 30 }
        ],
        default: 10
    },
    muteNotificationsOnLock: {
        type: OptionType.BOOLEAN,
        description: "Suppress notifications and sound for locked servers",
        default: true
    },
    panicShortcut: {
        type: OptionType.STRING,
        description: "Emergency Panic Lock Shortcut (Instantly locks all servers)",
        default: "Alt+Shift+L"
    },
    servers: {
        type: OptionType.CUSTOM,
        default: DEFAULT_SERVERS
    }
});

const NavigationUtils = findByPropsLazy("selectGuild", "selectChannel") as any;
const AppNavigationUtils = findByPropsLazy("selectGuild", "selectChannel") as any;
const AppChannelActions = findByPropsLazy("selectPrivateChannel") as any;

// Memory state: IDs of servers that are currently unlocked (shown).
const unlockedServerIds = new Set<string>();
const relockTimers = new Map<string, any>();

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function forceNavigateToDms() {
    try {
        if (NavigationRouter?.transitionTo) {
            NavigationRouter.transitionTo("/channels/@me");
        }
    } catch {}

    try {
        if (NavigationRouter?.transitionToGuild) {
            NavigationRouter.transitionToGuild("@me");
        }
    } catch {}

    try {
        if (AppNavigationUtils?.selectGuild) {
            AppNavigationUtils.selectGuild("@me");
            AppNavigationUtils.selectGuild(null);
        }
    } catch {}

    try {
        if (AppChannelActions?.selectPrivateChannel) {
            AppChannelActions.selectPrivateChannel(null);
        }
    } catch {}

    try {
        FluxDispatcher?.dispatch?.({
            type: "NAVIGATE_TO",
            path: "/channels/@me"
        });
    } catch {}
}

function forceLeaveIfHidden() {
    try {
        const currentGuildId = SelectedGuildStore?.getGuildId?.();
        if (!currentGuildId) return;

        const isConfigured = getServersList().some(s => s.id === currentGuildId);
        if (isConfigured && isServerLocked(currentGuildId)) {
            forceNavigateToDms();
        }
    } catch {
        // Safe fallback
    }
}

function notifyStateChange() {
    forceLeaveIfHidden();
    for (const listener of listeners) {
        listener();
    }
}

function getServersList(): HiddenServerConfig[] {
    const list = settings?.store?.servers;
    if (Array.isArray(list) && list.length > 0) {
        return list;
    }
    return DEFAULT_SERVERS;
}

function isServerLocked(guildId: string): boolean {
    return !unlockedServerIds.has(guildId);
}

function relockServer(guildId: string) {
    unlockedServerIds.delete(guildId);

    if (relockTimers.has(guildId)) {
        clearTimeout(relockTimers.get(guildId));
        relockTimers.delete(guildId);
    }

    forceLeaveIfHidden();
    notifyStateChange();
}

function lockAllServers() {
    for (const timer of relockTimers.values()) {
        clearTimeout(timer);
    }
    relockTimers.clear();

    unlockedServerIds.clear();
    forceLeaveIfHidden();
    notifyStateChange();
}

function unlockServer(serverConfig: HiddenServerConfig) {
    unlockedServerIds.add(serverConfig.id);

    if (relockTimers.has(serverConfig.id)) {
        clearTimeout(relockTimers.get(serverConfig.id));
        relockTimers.delete(serverConfig.id);
    }

    const timeoutMinutes = Number(settings?.store?.autoRelockTimeoutMinutes ?? 10);
    if (timeoutMinutes > 0) {
        const timer = setTimeout(() => {
            relockServer(serverConfig.id);
        }, timeoutMinutes * 60 * 1000);
        relockTimers.set(serverConfig.id, timer);
    }

    notifyStateChange();
}

/* ========================================================================== */
/* Keycap Badges Component                                                    */
/* ========================================================================== */

function KbdKeys({ shortcut }: { shortcut: string; }) {
    if (!shortcut) return null;
    const parts = shortcut.split("+").map(p => p.trim());
    return (
        <span className="hidden-server-kbd-container">
            {parts.map((part, index) => (
                <React.Fragment key={index}>
                    {index > 0 && <span className="hidden-server-kbd-plus">+</span>}
                    <kbd className="hidden-server-kbd-key">{part}</kbd>
                </React.Fragment>
            ))}
        </span>
    );
}

/* ========================================================================== */
/* Server Hotkey Matching                                                     */
/* ========================================================================== */

interface ParsedShortcut {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    key: string;
    code: string;
}

function parseShortcut(shortcutStr: string): ParsedShortcut {
    const norm = (shortcutStr || "").trim().toUpperCase();
    const parts = norm.split("+").map(p => p.trim());

    let ctrl = false;
    let alt = false;
    let shift = false;
    let meta = false;
    let mainKey = "";

    for (const part of parts) {
        if (part === "CTRL" || part === "CONTROL") ctrl = true;
        else if (part === "ALT") alt = true;
        else if (part === "SHIFT") shift = true;
        else if (part === "META" || part === "CMD" || part === "COMMAND" || part === "WIN") meta = true;
        else if (part !== "") mainKey = part;
    }

    const key = mainKey;
    const code = mainKey.length === 1 ? `KEY${mainKey}` : mainKey;

    return { ctrl, alt, shift, meta, key, code };
}

function matchEventWithShortcut(event: KeyboardEvent, parsed: ParsedShortcut): boolean {
    if (parsed.alt && !event.altKey) return false;
    if (parsed.ctrl && !event.ctrlKey) return false;
    if (parsed.shift && !event.shiftKey) return false;

    const eventKeyChar = (event.key?.length === 1 ? event.key : "").toUpperCase();
    const eventCodeChar = event.code?.startsWith("Key") ? event.code.slice(3).toUpperCase() : "";

    const matchKey = parsed.key;
    if (!matchKey) return false;

    if (eventKeyChar === matchKey) return true;
    if (eventCodeChar === matchKey) return true;
    if (event.code && event.code.toUpperCase() === parsed.code) return true;
    if (event.code && event.code.toUpperCase() === `KEY${matchKey}`) return true;

    return false;
}

function handleKeyDown(event: KeyboardEvent) {
    const panicStr = settings?.store?.panicShortcut || "Alt+Shift+L";
    const parsedPanic = parseShortcut(panicStr);
    if (matchEventWithShortcut(event, parsedPanic)) {
        event.preventDefault();
        event.stopPropagation();
        lockAllServers();
        return;
    }

    const servers = getServersList();
    for (const server of servers) {
        if (!server.shortcut) continue;
        const parsed = parseShortcut(server.shortcut);
        if (matchEventWithShortcut(event, parsed)) {
            event.preventDefault();
            event.stopPropagation();
            handleServerHotkey(server);
            return;
        }
    }
}

/* ========================================================================== */
/* Webpack Render-Level Patch Component                                       */
/* ========================================================================== */

function HiddenServerGuildNode({
    node,
    originalComponent,
}: {
    node: any;
    originalComponent: () => React.ReactNode;
}) {
    const forceUpdate = useForceUpdater();

    React.useEffect(() => {
        return subscribe(forceUpdate);
    }, [forceUpdate]);

    const guildId = node?.id ?? node?.guildId;
    if (guildId) {
        const configured = getServersList().some(s => s.id === guildId);
        if (configured && isServerLocked(guildId)) {
            return null;
        }
    }

    return originalComponent();
}

function wrapGuildNodeComponent(
    node: any,
    originalComponent: () => React.ReactNode,
) {
    return (
        <HiddenServerGuildNode
            node={node}
            originalComponent={originalComponent}
        />
    );
}

/* ========================================================================== */
/* Plugin Modals (Password, Add Server, Control Center)                      */
/* ========================================================================== */

function PasswordModal({ serverConfig, modalProps }: { serverConfig: HiddenServerConfig; modalProps: any; }) {
    const [passwordInput, setPasswordInput] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [shake, setShake] = useState(false);

    const handleUnlock = () => {
        if (passwordInput !== serverConfig.password) {
            setErrorMsg("Incorrect password! Please try again.");
            setShake(true);
            setTimeout(() => setShake(false), 500);
            return;
        }

        unlockServer(serverConfig);
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            title="🔒 Locked Server Access"
            subtitle={`Enter password to reveal server (${serverConfig.shortcut}).`}
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: modalProps.onClose,
                },
                {
                    text: "Unlock",
                    variant: "primary",
                    onClick: handleUnlock,
                    disabled: !passwordInput,
                },
            ]}
        >
            <div className="hidden-server-modal-container">
                <div className={`hidden-server-input-wrapper ${shake ? "hidden-server-shake" : ""}`}>
                    <label className="hidden-server-label">Password</label>
                    <div style={{ position: "relative" }}>
                        <TextInput
                            type={showPassword ? "text" : "password"}
                            value={passwordInput}
                            onChange={(value: string) => {
                                setPasswordInput(value);
                                if (errorMsg) setErrorMsg("");
                            }}
                            onKeyDown={(event: React.KeyboardEvent) => {
                                if (event.key === "Enter" && passwordInput) {
                                    event.preventDefault();
                                    handleUnlock();
                                }
                            }}
                            placeholder="Enter password..."
                            autoFocus
                        />
                        <button
                            type="button"
                            className="hidden-server-eye-toggle"
                            onClick={() => setShowPassword(!showPassword)}
                            title={showPassword ? "Hide Password" : "Show Password"}
                        >
                            {showPassword ? "🙈" : "👁️"}
                        </button>
                    </div>
                    {errorMsg && (
                        <div className="hidden-server-error-text">
                            ⚠️ {errorMsg}
                        </div>
                    )}
                </div>
                <div className="hidden-server-info-badge" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>Toggle visibility shortcut:</span>
                    <KbdKeys shortcut={serverConfig.shortcut} />
                </div>
            </div>
        </Modal>
    );
}

function getGuildAcronym(guild: any): string {
    if (guild?.acronym) return guild.acronym;
    const name = guild?.name || "";
    return name
        .replace(/'s /g, " ")
        .replace(/\w+/g, w => w[0])
        .replace(/\s+/g, "")
        .slice(0, 4)
        .toUpperCase() || "DC";
}

function AddServerModal({ modalProps }: { modalProps: any; }) {
    const [guildId, setGuildId] = useState("");
    const [shortcut, setShortcut] = useState("Alt+G");
    const [password, setPassword] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [manualMode, setManualMode] = useState(false);

    const configuredServers = getServersList();
    const configuredSet = React.useMemo(() => new Set(configuredServers.map(s => s.id)), [configuredServers]);

    const allGuilds = React.useMemo(() => {
        try {
            const map = GuildStore?.getGuilds?.() || {};
            return Object.values(map) as any[];
        } catch {
            return [];
        }
    }, []);

    const filteredGuilds = React.useMemo(() => {
        if (!searchQuery.trim()) return allGuilds;
        const q = searchQuery.toLowerCase();
        return allGuilds.filter(g =>
            (g.name && g.name.toLowerCase().includes(q)) ||
            (g.id && g.id.includes(q))
        );
    }, [allGuilds, searchQuery]);

    const selectedGuildObj = React.useMemo(() => {
        if (!guildId) return null;
        return allGuilds.find(g => g.id === guildId) || null;
    }, [allGuilds, guildId]);

    const handleAdd = () => {
        const cleanId = guildId.trim();
        const cleanShortcut = shortcut.trim();
        const cleanPassword = password.trim();

        if (!cleanId || !cleanShortcut || !cleanPassword) return;

        const currentList = getServersList();
        const updatedList = [
            ...currentList.filter(s => s.id !== cleanId),
            { id: cleanId, shortcut: cleanShortcut, password: cleanPassword }
        ];

        settings.store.servers = updatedList;
        notifyStateChange();
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            title="＋ Add Hidden Server"
            subtitle="Select a Discord server to hide or enter Server ID manually."
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: modalProps.onClose,
                },
                {
                    text: "Add Server",
                    variant: "primary",
                    onClick: handleAdd,
                    disabled: !guildId || !shortcut || !password,
                },
            ]}
        >
            <div className="hidden-server-modal-container">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="hidden-server-label">
                        {manualMode ? "Manual Server ID" : "Select Server"}
                    </label>
                    <Button
                        size="small"
                        variant="link"
                        onClick={() => setManualMode(!manualMode)}
                        style={{ padding: 0, minHeight: 0 }}
                    >
                        {manualMode ? "📋 Pick from List" : "⌨️ Manual ID"}
                    </Button>
                </div>

                {manualMode ? (
                    <div className="hidden-server-input-wrapper">
                        <TextInput
                            value={guildId}
                            onChange={setGuildId}
                            placeholder="e.g. 123456789012345678"
                            autoFocus
                        />
                    </div>
                ) : (
                    <div className="hidden-server-guild-picker-wrapper">
                        <TextInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="🔍 Search server by name or ID..."
                            style={{ marginBottom: 8 }}
                        />
                        <ScrollerThin className="hidden-server-guild-picker-list">
                            {filteredGuilds.length === 0 ? (
                                <div className="hidden-server-info-badge" style={{ textAlign: "center" }}>
                                    {allGuilds.length === 0 ? "No servers found." : "No matching servers found."}
                                </div>
                            ) : (
                                filteredGuilds.map(guild => {
                                    const isAdded = configuredSet.has(guild.id);
                                    const isSelected = guildId === guild.id;
                                    const iconUrl = guild.icon
                                        ? IconUtils?.getGuildIconURL?.({ id: guild.id, icon: guild.icon, size: 64 })
                                        : null;

                                    return (
                                        <div
                                            key={guild.id}
                                            className={`hidden-server-picker-item ${isSelected ? "selected" : ""} ${isAdded ? "disabled" : ""}`}
                                            onClick={() => {
                                                if (!isAdded) {
                                                    setGuildId(guild.id);
                                                }
                                            }}
                                        >
                                            <div className="hidden-server-picker-icon-container">
                                                {iconUrl ? (
                                                    <img src={iconUrl} className="hidden-server-picker-icon" alt={guild.name} />
                                                ) : (
                                                    <div className="hidden-server-picker-acronym">
                                                        {getGuildAcronym(guild)}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="hidden-server-picker-info">
                                                <div className="hidden-server-picker-name">{guild.name}</div>
                                                <div className="hidden-server-picker-id">ID: {guild.id}</div>
                                            </div>
                                            <div className="hidden-server-picker-badge">
                                                {isAdded ? (
                                                    <span className="badge-added">🔒 Added</span>
                                                ) : isSelected ? (
                                                    <span className="badge-selected">✓ Selected</span>
                                                ) : (
                                                    <span className="badge-select">Select</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </ScrollerThin>
                    </div>
                )}

                {guildId && (
                    <div className="hidden-server-info-badge">
                        Selected Server: <b>{selectedGuildObj ? selectedGuildObj.name : guildId}</b>
                    </div>
                )}

                <div className="hidden-server-input-wrapper">
                    <label className="hidden-server-label">Shortcut</label>
                    <TextInput
                        value={shortcut}
                        onChange={setShortcut}
                        placeholder="e.g. Alt+G"
                    />
                </div>
                <div className="hidden-server-input-wrapper">
                    <label className="hidden-server-label">Password</label>
                    <TextInput
                        type="password"
                        value={password}
                        onChange={setPassword}
                        placeholder="Set a password..."
                    />
                </div>
            </div>
        </Modal>
    );
}

function ControlCenterModal({ modalProps }: { modalProps: any; }) {
    const forceUpdate = useForceUpdater();
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [searchFilter, setSearchFilter] = useState("");

    React.useEffect(() => {
        return subscribe(forceUpdate);
    }, [forceUpdate]);

    const serversList = getServersList();
    const unlockedCount = serversList.filter(s => !isServerLocked(s.id)).length;
    const lockedCount = serversList.length - unlockedCount;

    const filteredList = React.useMemo(() => {
        if (!searchFilter.trim()) return serversList;
        const q = searchFilter.toLowerCase();
        return serversList.filter(s => s.id.includes(q) || s.shortcut.toLowerCase().includes(q));
    }, [serversList, searchFilter]);

    const handleToggleServer = (server: HiddenServerConfig) => {
        if (isServerLocked(server.id)) {
            openModal(pProps => (
                <PasswordModal serverConfig={server} modalProps={pProps} />
            ));
        } else {
            relockServer(server.id);
        }
    };

    const handleDeleteServer = (id: string) => {
        const updatedList = serversList.filter(s => s.id !== id);
        settings.store.servers = updatedList;
        unlockedServerIds.delete(id);
        notifyStateChange();
    };

    const handleOpenAddModal = () => {
        openModal(addProps => (
            <AddServerModal modalProps={addProps} />
        ));
    };

    const handleExportJson = () => {
        const jsonStr = JSON.stringify(serversList, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "hidden_servers_backup.json";
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const parsed = JSON.parse(content);

                if (Array.isArray(parsed)) {
                    const valid = parsed.every(item => typeof item.id === "string" && typeof item.shortcut === "string" && typeof item.password === "string");
                    if (valid) {
                        settings.store.servers = parsed;
                        notifyStateChange();
                    }
                }
            } catch {
                // Invalid JSON
            }
        };
        reader.readAsText(file);
    };

    const panicShortcut = settings?.store?.panicShortcut || "Alt+Shift+L";

    return (
        <Modal
            {...modalProps}
            title="🛡️ Hidden Servers — Control Center"
            subtitle="Manage hidden servers, panic locks, and settings backup"
            actions={[
                {
                    text: "Close",
                    variant: "secondary",
                    onClick: modalProps.onClose,
                },
            ]}
        >
            <div className="hidden-server-modal-container">
                {/* Metrics Dashboard Banner */}
                <div className="hidden-server-dashboard-metrics">
                    <div className="hidden-server-metric-item">
                        <span className="hidden-server-metric-label">Total</span>
                        <span className="hidden-server-metric-value">{serversList.length}</span>
                    </div>
                    <div className="hidden-server-metric-item">
                        <span className="hidden-server-metric-label">Unlocked</span>
                        <span className="hidden-server-metric-value positive">
                            <span className="hidden-server-pulse-dot" /> {unlockedCount}
                        </span>
                    </div>
                    <div className="hidden-server-metric-item">
                        <span className="hidden-server-metric-label">Locked</span>
                        <span className="hidden-server-metric-value locked">🔒 {lockedCount}</span>
                    </div>
                </div>

                {/* Panic Button Banner */}
                <div className="hidden-server-panic-banner">
                    <Button
                        variant="danger"
                        onClick={() => {
                            lockAllServers();
                            modalProps.onClose();
                        }}
                        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    >
                        <span>🚨 Emergency Panic Lock</span>
                        <KbdKeys shortcut={panicShortcut} />
                    </Button>
                </div>

                {/* Search Filter input if list > 2 */}
                {serversList.length > 2 && (
                    <TextInput
                        value={searchFilter}
                        onChange={setSearchFilter}
                        placeholder="🔍 Search hidden servers..."
                        style={{ marginBottom: 4 }}
                    />
                )}

                <div className="hidden-server-list">
                    {filteredList.length === 0 ? (
                        <div className="hidden-server-info-badge" style={{ textAlign: "center" }}>
                            {serversList.length === 0 ? "No hidden servers configured yet." : "No matching hidden servers found."}
                        </div>
                    ) : (
                        filteredList.map(server => {
                            const lockedState = isServerLocked(server.id);
                            return (
                                <div key={server.id} className="hidden-server-card">
                                    <div className="hidden-server-card-info">
                                        <div className="hidden-server-card-title">
                                            <span className="hidden-server-status-icon">
                                                {lockedState ? "🔴" : <span className="hidden-server-pulse-dot inline" />}
                                            </span>
                                            <span className="hidden-server-card-id-text">Server ({server.id.slice(0, 8)}...)</span>
                                        </div>
                                        <div className="hidden-server-card-meta" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                                            <span>Shortcut:</span>
                                            <KbdKeys shortcut={server.shortcut} />
                                            <span>— {lockedState ? "Locked" : "Unlocked"}</span>
                                        </div>
                                    </div>
                                    <div className="hidden-server-card-actions">
                                        <Button
                                            size="small"
                                            variant={lockedState ? "primary" : "secondary"}
                                            onClick={() => handleToggleServer(server)}
                                        >
                                            {lockedState ? "Show" : "Hide"}
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="danger"
                                            onClick={() => handleDeleteServer(server.id)}
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer Controls */}
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <Button
                        variant="primary"
                        onClick={handleOpenAddModal}
                    >
                        ＋ Add Server
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleExportJson}
                    >
                        📥 Export JSON
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        📤 Import JSON
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        style={{ display: "none" }}
                        onChange={handleImportFile}
                    />
                </div>
            </div>
        </Modal>
    );
}

function handleServerHotkey(server: HiddenServerConfig) {
    if (isServerLocked(server.id)) {
        openModal(modalProps => (
            <PasswordModal serverConfig={server} modalProps={modalProps} />
        ));
    } else {
        relockServer(server.id);
    }
}

function handleWindowBlur() {
    if (settings?.store?.autoRelockOnBlur) {
        lockAllServers();
    }
}

function handleNotificationDispatch(event: any) {
    if (!settings?.store?.muteNotificationsOnLock) return;

    if (event?.type === "MESSAGE_CREATE" || event?.type === "NOTIFICATION_CREATE") {
        const guildId = event?.message?.guild_id || event?.guildId;
        if (guildId && getServersList().some(s => s.id === guildId) && isServerLocked(guildId)) {
            if (event.message) {
                event.message.mentioned = false;
            }
        }
    }
}

/* ========================================================================== */
/* Plugin Definition & Lifecycle                                              */
/* ========================================================================== */

export default definePlugin({
    name: "HiddenServer",
    description: "Hide multiple Discord servers with password protection, panic lock hotkey, auto-relock timers, and visual control center.",
    authors: [
        {
            name: "whiteexcellent",
            id: 0n,
        },
    ],
    required: true,
    enabledByDefault: true,
    startAt: StartAt.Init,
    settings,

    shouldHideNode(node: any) {
        if (!node) return false;
        const guildId = node.id ?? node.guildId;
        if (!guildId) return false;

        const servers = getServersList();
        const config = servers.find(s => s.id === guildId);

        if (config && isServerLocked(guildId)) {
            return true;
        }

        return false;
    },

    patches: [
        {
            find: '("guildsnav")',
            replacement: {
                match: /switch\((\i)\.type\){.+?default:return null}/,
                replace: "return $self.wrapGuildNodeComponent($1,()=>{$&});",
            },
        },
    ],

    start() {
        unlockedServerIds.clear();

        document.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("blur", handleWindowBlur);

        try {
            FluxDispatcher?.subscribe?.("MESSAGE_CREATE", handleNotificationDispatch);
            FluxDispatcher?.subscribe?.("CHANNEL_SELECT", forceLeaveIfHidden);
            FluxDispatcher?.subscribe?.("GUILD_SELECT", forceLeaveIfHidden);
        } catch {
            // FluxDispatcher fallback
        }
    },

    stop() {
        document.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("blur", handleWindowBlur);

        try {
            FluxDispatcher?.unsubscribe?.("MESSAGE_CREATE", handleNotificationDispatch);
            FluxDispatcher?.unsubscribe?.("CHANNEL_SELECT", forceLeaveIfHidden);
            FluxDispatcher?.unsubscribe?.("GUILD_SELECT", forceLeaveIfHidden);
        } catch {
            // FluxDispatcher fallback
        }

        lockAllServers();
        listeners.clear();
    },

    wrapGuildNodeComponent,
});
