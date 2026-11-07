import { EquipmentPanel } from "../../../components/equipment";
import { Protected } from "../../../components/protected";
export default function Page() {
  return (
    <Protected>
      <h1>Your equipment, ready to go.</h1>
      <EquipmentPanel />
    </Protected>
  );
}
