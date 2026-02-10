export function AgentConfigSkeleton() {
  return (
    <div className="flex-1 h-full overflow-hidden">
      <div className="h-full flex flex-col px-4 md:px-12 pt-24 pb-4 animate-pulse">
        {/* Header skeleton */}
        <div className="mb-8">
          <div className="h-8 bg-background-tint-02 rounded w-48 mb-1" />
          <div className="h-4 bg-background-tint-02 rounded w-96 max-w-full" />
        </div>

        {/* Content area skeleton */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* File list skeleton */}
          <div className="w-48 shrink-0 overflow-y-auto border border-border rounded-lg">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="px-3 py-2 border-b border-border last:border-b-0"
              >
                <div className="h-5 bg-background-tint-02 rounded w-full" />
              </div>
            ))}
          </div>

          {/* Editor skeleton */}
          <div className="flex-1 flex flex-col min-w-0 border border-border rounded-lg overflow-hidden">
            {/* Editor header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background-tint-01">
              <div className="h-5 bg-background-tint-02 rounded w-40" />
              <div className="h-8 bg-background-tint-02 rounded w-20" />
            </div>

            {/* Editor content */}
            <div className="flex-1 p-4 space-y-2">
              <div className="h-4 bg-background-tint-02 rounded w-full" />
              <div className="h-4 bg-background-tint-02 rounded w-11/12" />
              <div className="h-4 bg-background-tint-02 rounded w-full" />
              <div className="h-4 bg-background-tint-02 rounded w-5/6" />
              <div className="h-4 bg-background-tint-02 rounded w-full" />
              <div className="h-4 bg-background-tint-02 rounded w-3/4" />
              <div className="h-4 bg-background-tint-02 rounded w-full" />
              <div className="h-4 bg-background-tint-02 rounded w-4/5" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
