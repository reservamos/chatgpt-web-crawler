import vm from "vm";
import puppeteer from "puppeteer";
import {
    ChatGPTAPI
} from 'chatgpt'

const chatGpt = new ChatGPTAPI({
    apiKey: '',
    model: 'gpt-4',
});

function sanitizeScript(script) {
    const matches = script.match(/```javascript([\s\S]*)```/);
    if (matches) {
        script = matches[1];
        console.log("Script wrapped in ```javascript ``` code block, extracting and trying again");
        return script;
    }
    const matches2 = script.match(/```([\s\S]*)```/);
    if (matches2) {
        script = matches2[1];
        console.log("Script wrapped in ``` ``` code block, extracting and trying again");
        return script;
    }
    const matches3 = script.match(/```js([\s\S]*)```/);
    if (matches3) {
        script = matches3[1];
        console.log("Script wrapped in ```js ``` code block, extracting and trying again");
        return script;
    }
    return script;
}

async function sendMessage(message, parentMessageId) {
    const response = await chatGpt.sendMessage(message, {
        parentMessageId
    });
    console.log("====================================");
    console.log("CHATGPT Prompt: " + message);
    console.log("---------------");
    console.log("CHATGPT Response " + response.text);
    console.log("====================================");
    await new Promise(r => setTimeout(r, 2000)); // wait 2 seconds cooldown
    return response;
}

async function getContentFromPage(page, selector) {
    const htmlContent = await page.evaluate((selector) => {
        const targetElement = document.querySelector(selector);

        if (!targetElement) {
            throw new Error(`Element with selector '${selector}' not found.`);
        }

        const elementCopy = targetElement.cloneNode(true);

        const scriptTags = elementCopy.getElementsByTagName('script');
        for (let i = scriptTags.length - 1; i >= 0; i--) {
            scriptTags[i].parentNode.removeChild(scriptTags[i]);
        }

        const styleTags = elementCopy.getElementsByTagName('style');
        for (let i = styleTags.length - 1; i >= 0; i--) {
            styleTags[i].parentNode.removeChild(styleTags[i]);
        }

        const imgTags = elementCopy.getElementsByTagName('img');
        for (let i = imgTags.length - 1; i >= 0; i--) {
            imgTags[i].parentNode.removeChild(imgTags[i]);
        }

        const svgTags = elementCopy.getElementsByTagName('svg');
        for (let i = svgTags.length - 1; i >= 0; i--) {
            svgTags[i].parentNode.removeChild(svgTags[i]);
        }

        return elementCopy.innerHTML.replace(/\s+/g, ' ').trim();
    }, selector);

    return htmlContent;
}

function splitPrompt(text, splitLength) {
    if (splitLength <= 0) {
        throw new Error("Max length must be greater than 0.");
    }

    var numParts = Math.ceil(text.length / splitLength);
    var fileData = [];

    for (var i = 0; i < numParts; i++) {
        var start = i * splitLength;
        var end = Math.min((i + 1) * splitLength, text.length);

        if (i === numParts - 1) {
            var content = '[START PART ' + (i + 1) + '/' + numParts + ']\n' + text.substring(start, end) + '\n[END PART ' + (i + 1) + '/' + numParts + ']';
            content += '\nALL PARTS SENT. Now you can continue processing the request.';
        } else {
            var content = 'Do not answer yet. This is just another part of the text I want to send you. Just receive and acknowledge as "Part ' + (i + 1) + '/' + numParts + ' received" and wait for the next part.\n[START PART ' + (i + 1) + '/' + numParts + ']\n' + text.substring(start, end) + '\n[END PART ' + (i + 1) + '/' + numParts + ']';
            content += '\nRemember not answering yet. Just acknowledge you received this part with the message "Part ' + (i + 1) + '/' + numParts + ' received" and wait for the next part.';
        }

        fileData.push({
            name: 'split_' + String(i + 1).padStart(3, '0') + '_of_' + String(numParts).padStart(3, '0') + '.txt',
            content: content
        });
    }

    return fileData;
}


async function scrapeWebsite(url, selector) {
    const browser = await puppeteer.launch({
        headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    await page.goto(url, {
        waitUntil: 'networkidle0'
    });
    const data = [];
    console.log("===== Running scrapping iteration =====");
    const htmlContent = await getContentFromPage(page, selector);
    const message = `${htmlContent}\n\nBased on the previous html, make a javascript code that will run on page.evaluate and must extract the information of each trip in an array format containing these fields for each trip (each element of the array must be a trip) [{departure_time, arrival_time, arrival, capacity, availability, sold, price, current_price, bus_line_code, bus_line_name, schedule_slug, with_stopovers}], your response must be only valid javascript for pupeeter page.evaluate and no other text or explanations will be accepted, only the response in valid javascript, 
    the response from your script will be parsed and the data extracted, no message before or after the script. the script must be wrapped in a function named evaluatePageToGetTrips() without any arguments
    do not apologize, do not send explanations do not split the message, no markup, no explanation, do not send partial code, only valid javascript code that will run on page.evaluate. only respond with code. Code:`;
    const prompts = splitPrompt(message, 8000);
    console.log(`Prompts a enviar: ${prompts.length}`);
    let i = 0;
    let response = '';
    let parentMessageId = null;
    for (const prompt of prompts) {
        i++;
        console.log(`Enviando prompt: ${prompt.name} ${i}/${prompts.length}`);
        const chatGPTResponse = await sendMessage(prompt.content, parentMessageId);
        response = chatGPTResponse.text;
        parentMessageId = chatGPTResponse.id;
        console.log(`Respuesta recibida: ${response}\n\n`);
    }
    let script = response + "";
    let iterations = 0;
    while (true) {
        iterations++;
        script = sanitizeScript(script);
        console.log(">>>>>>>> puppeteer iteration");
        console.log("Executing script:")
        console.log("------")
        console.log(script);
        console.log("------")
        try {
            const context = {};
            vm.createContext(context);
            vm.runInContext(script, context);
            console.log("function defined? " + !!context.evaluatePageToGetTrips);
            if (!context.evaluatePageToGetTrips) {
                throw new Error("evaluatePageToGetTrips function not defined");
            }
            const trips = await page.evaluate(context.evaluatePageToGetTrips);
            console.log({ trips });
            if (trips.length === 0) {
                console.log("No trips found, retrying");
                throw new Error("page.evaluate(evaluatePageToGetTrips) returned []. No trips found.");
            }
            await browser.close();
            return { iterations, trips };
        } catch (error) {
            // check if error is syntax error
            if (error instanceof SyntaxError) {
                // if all of that did not work, lets ask chatgpt to clean all the unnecesary text and leave only the javascript code
                const prompt = "Clean the text and leave only the javascript code, no explanations, no markup, no partial code, no explanations, no apologies, no text, only valid javascript code that will run on page.evaluate. only respond with code. Code:";
                const chatGPTResponse = await sendMessage(prompt, parentMessageId);
                response = chatGPTResponse.text;
                parentMessageId = chatGPTResponse.id;
                script = response + "";
                continue;
            }
            console.log("Execution failed")
            console.log({ error })
            let prompt = `The script you gave me failed, remember the script ran inside a pupeeter page.evaluate(evaluatePageToGetTrips) and it must return an array of objects with this format [{departure_time, arrival_time, arrival, capacity, availability, sold, price, current_price, bus_line_code, bus_line_name, schedule_slug, with_stopovers}] 
            each object in the array is a trip. The script you sent me \n${script}\n failed with this error: \n${error}\n\n\nSend me only the fixed script with the errors fixed and return only these fields departure_time, arrival_time, arrival, capacity, availability, sold, price, current_price, bus_line_code, bus_line_name, schedule_slug, with_stopovers in each object of the array
            the script must be wrapped in a function named evaluatePageToGetTrips() without any arguments. in your response do not include markup, no explanation, do not apologize, do not send explanations do not split the message, do not send partial code, only valid javascript code that will run on page.evaluate. only respond with code. Code:`;
            console.log({ parentMessageId });
            const chatGPTResponse = await sendMessage(prompt, parentMessageId);
            script = chatGPTResponse.text;
        }
    }

    await browser.close();
    return [];
}

async function main() {
    const url = 'https://www.pullmanbus.cl/es/pasajes-bus/santiago,chile/iquique,chile/01-06-2023';
    const selector = '.service-cards-container'

    const { trips, iterations } = await scrapeWebsite(url, selector);

    console.log(trips);
    console.log(`Returned ${trips.length} trips in ${iterations} iterations`);
}

main().catch(err => console.error(err)); 