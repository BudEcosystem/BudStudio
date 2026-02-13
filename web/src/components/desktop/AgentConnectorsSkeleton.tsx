export function AgentConnectorsSkeleton() {
  return (
    <div className="flex-1 h-full overflow-y-auto">
      <div className="px-4 md:px-12 pt-24 pb-4 animate-pulse">
        {/* Header skeleton */}
        <div className="h-8 bg-background-tint-02 rounded w-48 mb-1" />
        <div className="h-4 bg-background-tint-02 rounded w-80 mb-8" />

        {/* Card grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="border border-border rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-background-tint-02 rounded-full" />
                <div className="flex-1">
                  <div className="h-5 bg-background-tint-02 rounded w-32 mb-1" />
                  <div className="h-3 bg-background-tint-02 rounded w-48" />
                </div>
              </div>
              <div className="h-4 bg-background-tint-02 rounded w-full mb-3" />
              <div className="flex gap-2">
                <div className="h-5 bg-background-tint-02 rounded w-12" />
                <div className="h-5 bg-background-tint-02 rounded w-20" />
                <div className="h-5 bg-background-tint-02 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
