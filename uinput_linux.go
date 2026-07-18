//go:build linux

package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

const (
	evSyn = 0x00
	evKey = 0x01
	evAbs = 0x03

	synReport = 0x00

	absX        = 0x00
	absY        = 0x01
	absPressure = 0x18

	btnLeft  = 0x110
	btnRight = 0x111

	busUSB  = 0x03
	absCnt  = 0x40
	nameLen = 80

	pressureMax = 1023

	uiDevCreate  = 0x5501
	uiDevDestroy = 0x5502
	uiSetEvbit   = 0x40045564
	uiSetKeybit  = 0x40045565
	uiSetAbsbit  = 0x40045567
)

type inputID struct {
	Bustype uint16
	Vendor  uint16
	Product uint16
	Version uint16
}

type uinputUserDev struct {
	Name         [nameLen]byte
	ID           inputID
	FFEffectsMax uint32
	Absmax       [absCnt]int32
	Absmin       [absCnt]int32
	Absfuzz      [absCnt]int32
	Absflat      [absCnt]int32
}

type inputEvent struct {
	Sec   int64
	Usec  int64
	Type  uint16
	Code  uint16
	Value int32
}

type Device struct {
	f        *os.File
	absRange int
}

func newDevice(name string, absRange int) (*Device, error) {
	f, err := os.OpenFile("/dev/uinput", os.O_WRONLY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, fmt.Errorf("open /dev/uinput: %w (is the uinput module loaded and are you in the 'input' group?)", err)
	}
	fd := int(f.Fd())

	setBit := func(req uint, bit int) error {
		return unix.IoctlSetInt(fd, req, bit)
	}
	for _, ev := range []int{evSyn, evKey, evAbs} {
		if err := setBit(uint(uiSetEvbit), ev); err != nil {
			f.Close()
			return nil, fmt.Errorf("UI_SET_EVBIT %d: %w", ev, err)
		}
	}
	for _, btn := range []int{btnLeft, btnRight} {
		if err := setBit(uint(uiSetKeybit), btn); err != nil {
			f.Close()
			return nil, fmt.Errorf("UI_SET_KEYBIT %d: %w", btn, err)
		}
	}
	for _, axis := range []int{absX, absY, absPressure} {
		if err := setBit(uint(uiSetAbsbit), axis); err != nil {
			f.Close()
			return nil, fmt.Errorf("UI_SET_ABSBIT %d: %w", axis, err)
		}
	}

	dev := uinputUserDev{ID: inputID{Bustype: busUSB, Vendor: 1, Product: 1, Version: 1}}
	copy(dev.Name[:], name)
	dev.Absmax[absX] = int32(absRange)
	dev.Absmax[absY] = int32(absRange)
	dev.Absmax[absPressure] = pressureMax

	var buf bytes.Buffer
	if err := binary.Write(&buf, binary.LittleEndian, &dev); err != nil {
		f.Close()
		return nil, err
	}
	if _, err := f.Write(buf.Bytes()); err != nil {
		f.Close()
		return nil, fmt.Errorf("write uinput_user_dev: %w", err)
	}
	if err := unix.IoctlSetInt(fd, uint(uiDevCreate), 0); err != nil {
		f.Close()
		return nil, fmt.Errorf("UI_DEV_CREATE: %w", err)
	}

	return &Device{f: f, absRange: absRange}, nil
}

func (d *Device) emit(typ, code uint16, value int32) error {
	ev := inputEvent{Type: typ, Code: code, Value: value}
	var buf bytes.Buffer
	if err := binary.Write(&buf, binary.LittleEndian, &ev); err != nil {
		return err
	}
	_, err := d.f.Write(buf.Bytes())
	return err
}

func (d *Device) syn() error {
	return d.emit(evSyn, synReport, 0)
}

func (d *Device) Close() error {
	if d.f == nil {
		return nil
	}
	unix.IoctlSetInt(int(d.f.Fd()), uint(uiDevDestroy), 0)
	return d.f.Close()
}
