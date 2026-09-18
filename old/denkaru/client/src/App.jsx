function App() {
  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="h-16 bg-slate-800 text-white flex items-center px-4">
        Header
      </header>
      
      {/* h-[calc(100vh-64px)] でヘッダー分を引いた高さを確保し、
        grid で 2x2 に分割します 
      */}
      <main className="flex-1 grid grid-cols-2 grid-rows-2 border-4 border-red-500">
        <div className="border border-black">エリア1</div>
        <div className="border border-black">エリア2</div>
        <div className="border border-black">エリア3</div>
        <div className="border border-black">エリア4</div>
      </main>
    </div>
  );
}
