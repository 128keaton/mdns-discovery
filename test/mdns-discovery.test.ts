import {MulticastDNS} from '../src/mdns-discovery';

test('#defaultOptions', () => {
    const newInstance = new MulticastDNS();

    expect(newInstance.found).toEqual([]);
    expect(newInstance.clients).toEqual([]);
    expect(newInstance.options.ip).toEqual('224.0.0.251');
});

test('#example', () => {
    const options = {
        timeout: 40,
        returnOnFirstFound: true,
        name: '_CGI._tcp.local',
        find: '*'
    };

    const newInstance = new MulticastDNS(options);

    expect(newInstance.options.find).toEqual(options.find);
    expect(newInstance.options.question.name).toEqual(options.name);
    expect(newInstance.options.returnOnFirstFound).toEqual(options.returnOnFirstFound);

    newInstance.run((results) => {
        results.forEach(entry => console.log('A', entry));
    })
});

