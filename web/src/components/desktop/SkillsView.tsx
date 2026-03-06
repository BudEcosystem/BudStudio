"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import {
  Drawer,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";

interface Skill {
  id: number;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  requires_tools: string[];
  modes: string[];
  builtin: boolean;
  enabled: boolean;
  user_id: string | null;
}

interface SkillFormData {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  requires_tools: string;
  modes: string;
}

const EMPTY_FORM: SkillFormData = {
  slug: "",
  name: "",
  description: "",
  instructions: "",
  requires_tools: "",
  modes: "",
};

function parseList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function SkillCard({
  skill,
  onToggle,
  onSelect,
  onDelete,
}: {
  skill: Skill;
  onToggle: (id: number, enabled: boolean) => void;
  onSelect: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
}) {
  return (
    <div
      className="border border-border bg-background-tint-01 rounded-lg hover:shadow-sm transition-shadow flex flex-col cursor-pointer"
      onClick={() => onSelect(skill)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(skill);
        }
      }}
    >
      <div className="p-4 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-text-04 truncate">
                {skill.name}
              </span>
              {skill.builtin && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 bg-purple-100 text-purple-700 dark:bg-purple-600/20 dark:text-purple-300">
                  built-in
                </span>
              )}
            </div>
            <p className="text-xs text-text-02 mt-0.5">{skill.slug}</p>
          </div>
          {!skill.builtin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle(skill.id, !skill.enabled);
              }}
              className={cn(
                "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors",
                skill.enabled
                  ? "bg-purple-600"
                  : "bg-gray-300 dark:bg-gray-600"
              )}
              title={skill.enabled ? "Disable" : "Enable"}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform mt-0.5",
                  skill.enabled ? "translate-x-3.5" : "translate-x-0.5"
                )}
              />
            </button>
          )}
        </div>

        <p className="text-sm text-text-02 line-clamp-2 mt-2 mb-3">
          {skill.description}
        </p>

        <div className="flex items-center gap-1.5 flex-wrap">
          {skill.requires_tools.map((tool) => (
            <span
              key={tool}
              className="text-[10px] bg-background-neutral-03 px-2 py-0.5 rounded-md"
            >
              {tool}
            </span>
          ))}
          {skill.modes.length > 0
            ? skill.modes.map((mode) => (
                <span
                  key={mode}
                  className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                >
                  {mode}
                </span>
              ))
            : (
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  all modes
                </span>
              )}
        </div>
      </div>

      {!skill.builtin && (
        <div className="px-4 pb-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(skill);
            }}
            className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

interface SkillDetailDrawerProps {
  skill: Skill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onSave: (id: number, data: { name: string; description: string; instructions: string; requires_tools: string[]; modes: string[] }) => Promise<boolean>;
  isCreating: boolean;
  onCreate: (data: { slug: string; name: string; description: string; instructions: string; requires_tools: string[]; modes: string[] }) => Promise<boolean>;
}

function SkillDetailDrawer({
  skill,
  open,
  onOpenChange,
  onToggle,
  onSave,
  isCreating,
  onCreate,
}: SkillDetailDrawerProps) {
  const [form, setForm] = useState<SkillFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const isBuiltin = skill?.builtin ?? false;
  const isEditable = isCreating || !isBuiltin;

  useEffect(() => {
    if (isCreating) {
      setForm(EMPTY_FORM);
    } else if (skill) {
      setForm({
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        requires_tools: skill.requires_tools.join(", "),
        modes: skill.modes.join(", "),
      });
    }
  }, [skill, isCreating, open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let ok: boolean;
      if (isCreating) {
        ok = await onCreate({
          slug: form.slug.trim(),
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          requires_tools: parseList(form.requires_tools),
          modes: parseList(form.modes),
        });
      } else if (skill) {
        ok = await onSave(skill.id, {
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          requires_tools: parseList(form.requires_tools),
          modes: parseList(form.modes),
        });
      } else {
        ok = false;
      }
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-04";

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent direction="right">
        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b border-border">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-600/20 flex items-center justify-center text-purple-700 dark:text-purple-300 text-sm font-bold shrink-0">
              {(isCreating ? "+" : (skill?.name ?? "S").charAt(0).toUpperCase())}
            </div>
            <div className="flex-1 min-w-0">
              <DrawerTitle className="truncate">
                {isCreating ? "New Skill" : (skill?.name ?? "")}
              </DrawerTitle>
              <DrawerDescription className="text-xs truncate">
                {isCreating
                  ? "Create a new custom skill"
                  : skill?.slug ?? ""}
              </DrawerDescription>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!isCreating && skill && !skill.builtin && (
              <button
                onClick={() => onToggle(skill.id, !skill.enabled)}
                className={cn(
                  "relative inline-flex h-4 w-7 cursor-pointer rounded-full transition-colors",
                  skill.enabled
                    ? "bg-purple-600"
                    : "bg-gray-300 dark:bg-gray-600"
                )}
                title={skill.enabled ? "Disable" : "Enable"}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform mt-0.5",
                    skill.enabled ? "translate-x-3.5" : "translate-x-0.5"
                  )}
                />
              </button>
            )}
            <DrawerClose className="rounded-sm opacity-70 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Badges */}
          {!isCreating && skill && (
            <div className="px-4 pt-4 flex items-center gap-2 flex-wrap">
              {skill.builtin && (
                <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-600/20 dark:text-purple-300 px-2 py-0.5 rounded-full">
                  Built-in
                </span>
              )}
              {!skill.builtin && (
                <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                  Custom
                </span>
              )}
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  skill.enabled
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                    : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                )}
              >
                {skill.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          )}

          {/* Form fields */}
          <div className="p-4 space-y-4">
            {/* Slug — only editable when creating */}
            {isCreating && (
              <div>
                <label className="text-xs font-semibold text-text-03 mb-1.5 block uppercase tracking-wide">
                  Slug
                </label>
                <input
                  className={inputClass}
                  placeholder="e.g. daily_standup"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                />
                <p className="text-[11px] text-text-02 mt-1">
                  Unique identifier. Cannot be changed after creation.
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-text-03 mb-1.5 block uppercase tracking-wide">
                Name
              </label>
              <input
                className={inputClass}
                placeholder="e.g. Daily Standup Summary"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={!isEditable}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-text-03 mb-1.5 block uppercase tracking-wide">
                Description
              </label>
              <input
                className={inputClass}
                placeholder="Short description of what this skill does"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={!isEditable}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-text-03 mb-1.5 block uppercase tracking-wide">
                Instructions
              </label>
              <textarea
                className={cn(inputClass, "resize-y min-h-[180px]")}
                placeholder="Step-by-step instructions the agent should follow when this skill is activated..."
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                disabled={!isEditable}
              />
              <p className="text-[11px] text-text-02 mt-1">
                Shown to the agent when it calls <code className="text-[11px]">use_skill</code>.
              </p>
            </div>

            <div className="border-t border-border pt-4">
              <label className="text-xs font-semibold text-text-03 mb-1.5 block uppercase tracking-wide">
                Required Tools
              </label>
              <input
                className={inputClass}
                placeholder="e.g. bash, read_file"
                value={form.requires_tools}
                onChange={(e) => setForm({ ...form, requires_tools: e.target.value })}
                disabled={!isEditable}
              />
              <p className="text-[11px] text-text-02 mt-1">
                Comma-separated. Skill is only available when all listed tools are present.
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-text-03 mb-1.5 block uppercase tracking-wide">
                Modes
              </label>
              <input
                className={inputClass}
                placeholder="e.g. interactive, cron, inbox"
                value={form.modes}
                onChange={(e) => setForm({ ...form, modes: e.target.value })}
                disabled={!isEditable}
              />
              <p className="text-[11px] text-text-02 mt-1">
                Comma-separated. Leave empty for all modes.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        {isEditable && (
          <div className="p-4 border-t border-border flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || (isCreating && (!form.slug.trim() || !form.name.trim()))}
              className="flex-1 px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : isCreating ? "Create Skill" : "Save Changes"}
            </button>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

export function SkillsView() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const loadSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/skill");
      if (!res.ok) throw new Error(await res.text());
      const data: Skill[] = await res.json();
      setSkills(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleToggle = useCallback(
    async (id: number, enabled: boolean) => {
      setSkills((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled } : s))
      );
      try {
        const res = await fetch(`/api/admin/skill/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        if (!res.ok) throw new Error();
      } catch {
        setSkills((prev) =>
          prev.map((s) => (s.id === id ? { ...s, enabled: !enabled } : s))
        );
      }
    },
    []
  );

  const handleSelect = useCallback((skill: Skill) => {
    setSelectedSkill(skill);
    setIsCreating(false);
    setDrawerOpen(true);
  }, []);

  const handleCreate = useCallback(() => {
    setSelectedSkill(null);
    setIsCreating(true);
    setDrawerOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (skill: Skill) => {
      if (!confirm(`Delete skill "${skill.name}"?`)) return;
      try {
        const res = await fetch(`/api/admin/skill/${skill.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(await res.text());
        setSkills((prev) => prev.filter((s) => s.id !== skill.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete skill");
      }
    },
    []
  );

  const handleSave = useCallback(
    async (
      id: number,
      data: { name: string; description: string; instructions: string; requires_tools: string[]; modes: string[] }
    ): Promise<boolean> => {
      try {
        const res = await fetch(`/api/admin/skill/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          setError(await res.text());
          return false;
        }
        await loadSkills();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update skill");
        return false;
      }
    },
    [loadSkills]
  );

  const handleCreateSubmit = useCallback(
    async (data: {
      slug: string;
      name: string;
      description: string;
      instructions: string;
      requires_tools: string[];
      modes: string[];
    }): Promise<boolean> => {
      try {
        const res = await fetch("/api/admin/skill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          setError(await res.text());
          return false;
        }
        await loadSkills();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create skill");
        return false;
      }
    },
    [loadSkills]
  );

  // Keep selected skill in sync with skills list
  useEffect(() => {
    if (selectedSkill) {
      const updated = skills.find((s) => s.id === selectedSkill.id);
      if (updated) setSelectedSkill(updated);
    }
  }, [skills, selectedSkill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-sm text-muted-foreground">
        Loading skills...
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-y-auto" data-testid="skills-view">
      <div className="px-4 md:px-12 pt-12 pb-4">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-text-04">Skills</h1>
          <button
            onClick={handleCreate}
            className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            + New Skill
          </button>
        </div>
        <p className="text-sm text-text-02 mb-8">
          Reusable instruction packages that teach the agent how to perform
          specific tasks. The agent activates a skill with{" "}
          <code className="text-sm">use_skill</code> when a request matches.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center justify-between">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 dark:hover:text-red-300 ml-3 shrink-0"
            >
              &#10005;
            </button>
          </div>
        )}

        {skills.length === 0 ? (
          <p className="text-sm text-text-02">
            No skills configured. Create one to get started.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={handleToggle}
                onSelect={handleSelect}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <SkillDetailDrawer
        skill={selectedSkill}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onToggle={handleToggle}
        onSave={handleSave}
        isCreating={isCreating}
        onCreate={handleCreateSubmit}
      />
    </div>
  );
}
