module.exports = {
    transform: {
        '^.+\\.tsx?$': 'ts-jest'
    },
    coverageDirectory: 'test/coverage',
    testRegex: '/test/mdns-discovery.test.ts',
    testEnvironment: 'node',
    moduleFileExtensions: ['js', 'ts'],
};
