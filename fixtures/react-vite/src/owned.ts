import { initializeApplicationInsights } from "react-telemetry-kit/appinsights/initialize";

async function verifyOwnedClient(): Promise<void> {
  const result = document.getElementById("result");
  if (!result) throw new Error("Missing result element");
  const client = initializeApplicationInsights({
    connectionString:
      "InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=http://127.0.0.1:41789/",
  });
  try {
    await client.ready;
    await client.flush();
    await client.dispose();
    result.dataset.status = "pass";
    result.textContent = "Real Application Insights SDK initialized, flushed, and disposed";
  } catch (error) {
    result.dataset.status = "fail";
    result.textContent = String(error);
  }
}

void verifyOwnedClient();
