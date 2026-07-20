.PHONY: build run clean vet test

# Build the optimized binary
build:
	go build -ldflags="-s -w" -o hearme .

# Build with debug symbols (for development)
build-debug:
	go build -o hearme .

# Run the server
run: build
	./hearme

# Run without rebuilding
run-only:
	./hearme

# Vet the code
vet:
	go vet ./...

# Clean build artifacts
clean:
	rm -f hearme

# Build for all platforms
release:
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/hearme-linux-amd64 .
	GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/hearme-linux-arm64 .
	GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/hearme-darwin-amd64 .
	GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/hearme-darwin-arm64 .
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/hearme-windows-amd64.exe .
	ls -lh dist/
