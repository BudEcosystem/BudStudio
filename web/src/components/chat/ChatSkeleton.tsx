export function ChatSkeleton() {
  return (
    <div className="flex flex-col h-screen animate-pulse">
      {/* Messages area skeleton */}
      <div className="flex-1 overflow-hidden px-4 py-6">
        <div className="max-w-message-max mx-auto space-y-8">
          {/* User message skeleton */}
          <div className="flex justify-end">
            <div className="max-w-[25rem] w-64 h-12 bg-background-tint-02 rounded-t-16 rounded-bl-16" />
          </div>

          {/* Agent message skeleton */}
          <div className="flex gap-3">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-background-tint-02 flex-shrink-0" />
            {/* Message content */}
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-background-tint-02 rounded w-full" />
              <div className="h-4 bg-background-tint-02 rounded w-5/6" />
              <div className="h-4 bg-background-tint-02 rounded w-4/6" />
            </div>
          </div>

          {/* User message skeleton */}
          <div className="flex justify-end">
            <div className="max-w-[25rem] w-48 h-12 bg-background-tint-02 rounded-t-16 rounded-bl-16" />
          </div>

          {/* Agent message skeleton */}
          <div className="flex gap-3">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-background-tint-02 flex-shrink-0" />
            {/* Message content */}
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-background-tint-02 rounded w-full" />
              <div className="h-4 bg-background-tint-02 rounded w-11/12" />
              <div className="h-4 bg-background-tint-02 rounded w-3/4" />
              <div className="h-4 bg-background-tint-02 rounded w-5/6" />
            </div>
          </div>
        </div>
      </div>

      {/* Input area skeleton */}
      <div className="p-4 flex justify-center">
        <div className="w-full max-w-searchbar-max">
          <div className="h-14 bg-background-tint-02 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
