import { ClassicEditor } from "smartrte-react";

function App() {
  return (
    <div style={{ padding: 20 }}>
      <h2>Smart RTE: React ClassicEditor</h2>
      <ClassicEditor
        minHeight={200}
        maxHeight={400}
        onChange={(html) => console.log("Classic HTML:", html)}
      />
    </div>
  );
}

export default App;
