import {MulticastDNS} from "../src/mdns-discovery";

const options = {
    timeout: 40,
    returnOnFirstFound: true,
    name: '_CGI._tcp.',
    find: '*'
};

const newInstance = new MulticastDNS(options);


newInstance.run((results) => {
    results.forEach(entry => console.log('A', entry));
})
