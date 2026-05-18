import { NewCampaignForm } from "./_components/new-campaign-form";

export default function NewCampaignPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nueva Campana</h1>
        <p className="text-sm text-muted-foreground">
          Crea una campana para organizar tus cuentas target
        </p>
      </div>
      <NewCampaignForm />
    </div>
  );
}
