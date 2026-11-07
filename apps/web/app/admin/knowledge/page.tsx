import { Protected } from "../../../components/protected";
import { KnowledgeLibrary } from "../../../components/knowledge-library";
export default function Page() {
  return (
    <Protected>
      <KnowledgeLibrary />
    </Protected>
  );
}
