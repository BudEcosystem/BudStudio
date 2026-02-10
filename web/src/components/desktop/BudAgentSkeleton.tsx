export function BudAgentSkeleton() {
  return (
    <div className="mx-auto py-4 px-4 lg:px-5 w-[90%] max-w-message-max">
      <div className="space-y-8 animate-pulse">
        {/* User message skeleton */}
        <div className="pt-5 pb-1 w-full flex">
          <div className="ml-auto max-w-[25rem] w-64 h-16 bg-background-tint-02 rounded-t-16 rounded-bl-16" />
        </div>

        {/* Agent message skeleton */}
        <div className="py-5 relative flex">
          <div className="w-full max-w-message-max mx-auto">
            <div className="flex items-start">
              {/* Avatar skeleton */}
              <div className="w-8 h-8 rounded-full bg-background-tint-02 flex-shrink-0" />

              {/* Message content skeleton */}
              <div className="w-full ml-4 space-y-3">
                <div className="h-4 bg-background-tint-02 rounded w-full" />
                <div className="h-4 bg-background-tint-02 rounded w-11/12" />
                <div className="h-4 bg-background-tint-02 rounded w-4/5" />
              </div>
            </div>
          </div>
        </div>

        {/* User message skeleton */}
        <div className="pt-5 pb-1 w-full flex">
          <div className="ml-auto max-w-[25rem] w-48 h-12 bg-background-tint-02 rounded-t-16 rounded-bl-16" />
        </div>

        {/* Agent message skeleton */}
        <div className="py-5 relative flex">
          <div className="w-full max-w-message-max mx-auto">
            <div className="flex items-start">
              {/* Avatar skeleton */}
              <div className="w-8 h-8 rounded-full bg-background-tint-02 flex-shrink-0" />

              {/* Message content skeleton */}
              <div className="w-full ml-4 space-y-3">
                <div className="h-4 bg-background-tint-02 rounded w-full" />
                <div className="h-4 bg-background-tint-02 rounded w-5/6" />
                <div className="h-4 bg-background-tint-02 rounded w-3/4" />
                <div className="h-4 bg-background-tint-02 rounded w-11/12" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
