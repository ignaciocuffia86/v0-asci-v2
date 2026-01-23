import Script from "next/script"

export function NetHuntForm() {
  return (
    <div className="w-full">
      <div id="form-container" className="w-full mx-auto rounded-xl overflow-hidden"></div>
      <Script
        async
        src="https://nethunt.com/service/automation/forms/69265b521fe70839b7c0d058?embed=script"
        strategy="afterInteractive"
      />
      <Script strategy="afterInteractive">
        {`
          function nhform() {
            (nhform.data || (nhform.data = [])).push(arguments);
          }
          nhform('container', document.getElementById('form-container'));
          nhform('show', true);
        `}
      </Script>
    </div>
  )
}
