const { setInterval } = require('timers');
const SteamCommunity = require('./index')

process.on('SIGINT', function() {
	console.log( "\nGracefully shutting down from SIGINT (Ctrl-C)" );
	// some other closing procedures go here
	process.exit(1);
  });

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

;(async ()=>{
	const communityCycleTLS = new SteamCommunity({
        useCycleTLS: true,
            // ja3: "770,4865-4867-49195-52393-49199-52392-52393-49199-52392", // Example JA3 string
            // userAgent: "CustomCycleTLSUserAgent/2.0",
        // Optionally override other defaults
    });
	const communityCycleTLS2 = new SteamCommunity({
        useCycleTLS: true,
            // ja3: "770,4865-4867-49195-52393-49199-52392-52393-49199-52392", // Example JA3 string
            // userAgent: "CustomCycleTLSUserAgent/2.0",
        // Optionally override other defaults
    });

	const sendRequestAndLogJA3 = (communityInstance, label) => {
        const options = {
            url: "https://check.ja3.zone/",
            method: "GET"
        };

        communityInstance.httpRequestGet(options, (err, response, body) => {
            if (err) {
                console.error(`[${label}] Error:`, err);
                return;
            }
            console.log(`[${label}] JA3 Check Response:`, body);
        });
    };

    // // Send requests
    // // sendRequestAndLogJA3(communityDefault, "Default Request");
    sendRequestAndLogJA3(communityCycleTLS, "CycleTLS");

	await (sleep(3000));
    // sendRequestAndLogJA3(communityCycleTLS2, "CycleTLS");

    // setInterval(() => {
        
    //     sendRequestAndLogJA3(communityCycleTLS, "CycleTLS");
    // }, 5000);

})()