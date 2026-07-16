export default function ProductLoading() {
  return (
    <div className="space-y-6 p-4 animate-pulse">
      <div className="h-8 w-64 bg-gray-200 rounded" />
      <div className="aspect-square w-full max-w-2xl bg-gray-200 rounded" />
      <div className="space-y-2">
        <div className="h-4 w-full bg-gray-200 rounded" />
        <div className="h-4 w-3/4 bg-gray-200 rounded" />
        <div className="h-4 w-1/2 bg-gray-200 rounded" />
      </div>
    </div>
  );
}
