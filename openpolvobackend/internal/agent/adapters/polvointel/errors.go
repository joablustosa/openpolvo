package polvointel

import (
	"errors"
	"fmt"
	"net"
	"strings"
)

// ErrUnreachable indica que o serviço Open Polvo Intelligence não está acessível
// (ex.: processo parado ou porta 8090 fechada).
var ErrUnreachable = errors.New("open polvo intelligence unreachable")

func wrapTransportError(err error) error {
	if err == nil {
		return nil
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op == "dial" {
		return fmt.Errorf("%w: inicie Intelligence (cd openpolvointeligence && python -m openpolvointeligence.main): %v", ErrUnreachable, err)
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "connection refused") || strings.Contains(msg, "actively refused") {
		return fmt.Errorf("%w: inicie Intelligence (cd openpolvointeligence && python -m openpolvointeligence.main): %v", ErrUnreachable, err)
	}
	return err
}
